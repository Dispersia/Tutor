import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { env, roleReasoning } from '../apps/server/src/env'
import { openDb, type Db } from '../apps/server/src/db/client'
import {
  getRoles,
  getUserSetting,
  listDecks,
  listUsers,
  updateDeckSettings,
} from '../apps/server/src/db/repo'
import { decryptSecret } from '../apps/server/src/auth'
import { OpenRouter } from '../apps/server/src/llm/openrouter'
import {
  lexiconFile,
  readLexicon,
  writeLexicon,
  type Lexicon,
} from '../apps/server/src/deck/lexicon'
import { pathWords } from '../apps/server/src/deck/path'
import { parseInstruction } from '../apps/server/src/deck/instruction'
import {
  buildLexicon,
  coverage,
  curatedWords,
  fetchMeanings,
  harvestWords,
  wordsMissingMeanings,
  type WordInfo,
} from '../apps/server/src/deck/lexiconBuild'
import type { UserId } from '../apps/server/src/ids'

const args = process.argv.slice(2)
const FILL = args.includes('--fill')
const TRIM = args.includes('--trim')
const limitArg = Number(args.find((a) => a.startsWith('--limit='))?.slice(8))
const LIMIT = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : Infinity
const langsArg = args
  .find((a) => a.startsWith('--lang='))
  ?.slice(7)
  .split(',')
  .filter(Boolean)
const LANGS = langsArg?.length ? langsArg : ['zh', 'ja', 'ko']

const dataDir = process.env.TUTOR_DATA_DIR ?? join(homedir(), '.local/share/tutor')
const live = openDb(join(dataDir, 'tutor.db'))
const sourcePath = process.env.LEXICON_SOURCE ?? sourceBackup(dataDir)
const source = openDb(sourcePath)

function sourceBackup(dir: string): string {
  const backups = join(dir, 'backups')
  const files = readdirSync(backups)
    .filter((f) => f.endsWith('.db'))
    .map((f) => join(backups, f))
  let best = ''
  let most = -1
  for (const file of files) {
    const cards = countCards(file)
    if (cards > most) {
      most = cards
      best = file
    }
  }
  if (!best) throw new Error(`no backup in ${backups} to read the old words from`)
  console.log(`[lexicon] source: ${basename(best)} (${most} cards)`)
  return best
}

function countCards(file: string): number {
  try {
    const out = execFileSync('sqlite3', [`file:${file}?mode=ro`, 'select count(*) from cards;'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return Number(out.trim()) || 0
  } catch {
    return 0
  }
}

function previousWords(lang: string): Map<string, WordInfo> {
  const lex = readLexicon(lexiconFile(lang, dataDir))
  return new Map(
    Object.entries(lex?.words ?? {}).map(([word, entry]) => [
      word,
      { reading: entry.reading, meaning: entry.meaning },
    ]),
  )
}

async function buildOne(lang: string): Promise<void> {
  const harvested = harvestWords(source.db, lang)
  const order = await pathWords(lang, {
    saved: [...harvested.keys()],
    variant: parseInstruction('', lang).variant,
  })
  if (!order.length) throw new Error(`no word order for ${lang}`)
  const lex = buildLexicon(lang, order, [harvested, previousWords(lang), curatedWords(lang)])
  writeLexicon(lexiconFile(lang, dataDir), lex)
  const c = coverage(lex)
  console.log(`[lexicon] ${lang}: ${c.total} words, ${c.meanings} meanings, ${c.readings} readings`)
}

function adminId(db: Db): UserId {
  const users = listUsers(db)
  const admin = users.find((u) => u.role === 'admin') ?? users[0]
  if (!admin) throw new Error('no users in the database')
  return admin.id
}

async function openRouterFor(db: Db, userId: UserId): Promise<OpenRouter> {
  const stored = getUserSetting(db, userId, 'openrouter_key') || undefined
  const key = (await decryptSecret(stored, env.secret)) ?? env.openrouterKey
  if (!key) throw new Error('no OpenRouter key for this user')
  return new OpenRouter(key, undefined)
}

function applyMeanings(lex: Lexicon, found: Map<string, string>): number {
  let added = 0
  for (const [word, meaning] of found) {
    const entry = lex.words[word]
    if (entry && !entry.meaning) {
      entry.meaning = meaning
      added++
    }
  }
  return added
}

async function fillOne(or: OpenRouter, model: string, lang: string): Promise<void> {
  const file = lexiconFile(lang, dataDir)
  const lex = readLexicon(file)
  if (!lex) return
  let budget = LIMIT
  while (budget > 0) {
    const size = budget === Infinity ? 40 : Math.min(40, budget)
    const batch = wordsMissingMeanings(lex, size)
    if (!batch.length) return
    const found = await fetchMeanings(or, model, roleReasoning.generator, lang, batch)
    const added = applyMeanings(lex, found)
    writeLexicon(file, lex)
    budget -= batch.length
    console.log(`[lexicon] ${lang}: +${added}/${batch.length} meanings`)
    if (added === 0) return
  }
}

function trimDecks(db: Db, langs: string[]): void {
  for (const deck of listDecks(db)) {
    if (deck.settings.kind !== 'path' || !langs.includes(deck.targetLang)) continue
    if (!deck.settings.words) continue
    updateDeckSettings(db, deck.id, { words: undefined })
    console.log(`[lexicon] ${deck.name}: word list moved to the dictionary`)
  }
}

for (const lang of LANGS) await buildOne(lang)

if (FILL) {
  const or = await openRouterFor(live.db, adminId(live.db))
  for (const lang of LANGS) await fillOne(or, generatorModel(live.db, adminId(live.db)), lang)
}

if (TRIM) trimDecks(live.db, LANGS)

function generatorModel(db: Db, userId: UserId): string {
  return getRoles(db, userId, env.defaultRoles).generator
}

for (const lang of LANGS) {
  const lex = readLexicon(lexiconFile(lang, dataDir))
  if (!lex) continue
  const c = coverage(lex)
  console.log(`[lexicon] ${lang}: final ${c.meanings}/${c.total} meanings, ${c.readings} readings`)
}

live.sqlite.close()
source.sqlite.close()
