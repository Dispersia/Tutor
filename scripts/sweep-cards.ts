import { env } from '../apps/server/src/env'
import { openDb } from '../apps/server/src/db/client'
import { getRoles, getUserSetting } from '../apps/server/src/db/repo'
import { decryptSecret } from '../apps/server/src/auth'
import { OpenRouter } from '../apps/server/src/llm/openrouter'
import type { CharacterVariant } from '../apps/server/src/frequency/source'
import { sweepDeck, type DeckRow, type SweepRun } from '../apps/server/src/deck/sweep'
import type { DeckId, UserId } from '../apps/server/src/ids'

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const concurrency = flagNumber('--concurrency', 4)
const limit = flagNumber('--limit', 0)
const modelFlag = args.indexOf('--model')
const modelOverride = modelFlag >= 0 ? args[modelFlag + 1] : undefined
const target = args.find((a, i) => !a.startsWith('--') && !isFlagValue(args[i - 1]))

function flagNumber(flag: string, fallback: number): number {
  const i = args.indexOf(flag)
  if (i < 0) return fallback
  return Math.max(1, Number(args[i + 1]) || fallback)
}

function isFlagValue(prev: string | undefined): boolean {
  return prev === '--concurrency' || prev === '--limit' || prev === '--model'
}

const { db, sqlite } = openDb(`${env.dataDir.replace(/\/+$/, '')}/tutor.db`)
const run: SweepRun = (sql, params) => sqlite.run(sql, params ?? [])

const deckRows = sqlite
  .query(
    'select id, user_id as userId, name, source_lang as sourceLang, target_lang as targetLang, settings_json as settingsJson from decks',
  )
  .all() as {
  id: DeckId
  userId: UserId
  name: string
  sourceLang: string
  targetLang: string
  settingsJson: string
}[]

const decks: DeckRow[] = deckRows.map((row) => {
  const settings = JSON.parse(row.settingsJson || '{}') as {
    instruction?: string
    variant?: CharacterVariant
    readingScript?: string
  }
  return {
    ...row,
    instruction: settings.instruction ?? 'Continue the deck',
    variant: settings.variant,
    readingScript: settings.readingScript,
  }
})

const chosen =
  !target || target === 'all'
    ? decks
    : decks.filter((d) => d.id === target || d.name.toLowerCase().includes(target.toLowerCase()))
if (chosen.length === 0) {
  console.error(`no deck matching ${JSON.stringify(target ?? 'all')} in ${env.dataDir}`)
  process.exit(1)
}

async function keyFor(userId: UserId): Promise<string | undefined> {
  const own = await decryptSecret(
    getUserSetting(db, userId, 'openrouter_key') || undefined,
    env.secret,
  )
  return own ?? env.openrouterKey
}

async function main(): Promise<void> {
  const first = chosen[0]!
  const key = await keyFor(first.userId)
  if (!key) {
    console.error('no OpenRouter key (user or server) — set OPENROUTER_API_KEY')
    process.exit(1)
  }
  const model = modelOverride ?? getRoles(db, first.userId, { ...env.defaultRoles }).judge
  console.log(`sweeping ${chosen.length} deck(s) with ${model}${dry ? ' (dry run)' : ''}`)
  const or = new OpenRouter(key, undefined)
  for (const deck of chosen) await sweepDeck({ db, run, or, model, deck, dry, concurrency, limit })
  sqlite.close()
}

void main()
