import type { UserId } from '../../ids'
import type { Context } from 'hono'
import type { App, AppEnv, Deps } from '../../context'
import {
  getDeck,
  rememberedDeckInstruction,
  setUserSetting,
  updateDeckSettings,
} from '../../db/repo'
import { detectLanguage, grammarFromAnki, inspectAnki, wordsFromAnki } from '../../anki/words'
import type { GrammarEntry } from '../../anki/words'
import { readApkg } from '../../anki/parse'
import {
  MAX_DECK_WORDS,
  createDeckForBuild,
  parseInstruction,
  startDeckBuild,
} from '../../deck/generate'
import {
  createGrammarDeck,
  type GrammarDeckOptions,
  type GrammarDeckResult,
} from '../../deck/grammarDeck'
import { startGrammarExamples } from '../../deck/grammarExamples'
import { knownWordsFor } from '../../services'
import { plannerFor } from '../../deck/planner'
import { DECK_INSTRUCTION_KEY } from '../../deck/settings'
import { deckView } from './view'
import { fail, needKey } from '../errors'

type Parsed = Awaited<ReturnType<typeof readApkg>>
type AnkiList = ReturnType<typeof wordsFromAnki>
type Planner = Awaited<ReturnType<typeof plannerFor>>
type Rules = ReturnType<typeof parseInstruction>
type Built = Awaited<ReturnType<typeof createDeckForBuild>>

export function registerDeckImport(app: App) {
  app.post('/api/decks/inspect', (c) => inspectHandler(c))
  app.post('/api/decks/import', (c) => importHandler(c))
}

async function inspectHandler(c: Context<AppEnv>) {
  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return fail(c, 400, 'an .apkg file is required')
  try {
    const parsed = await readApkg(new Uint8Array(await file.arrayBuffer()))
    return c.json(inspectAnki(parsed, targetLangOf(form, parsed)))
  } catch (err) {
    return fail(c, 502, (err as Error).message)
  }
}

async function importHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return fail(c, 400, 'an .apkg file is required')
  try {
    const parsed = await readApkg(new Uint8Array(await file.arrayBuffer()))
    const targetLang = targetLangOf(form, parsed)
    if (kindOf(form) === 'grammar')
      return await grammarImport(c, { deps, user, form, parsed, targetLang })
    const planner = await plannerFor(deps, user.id)
    if (!planner) return needKey(c)
    const list = wordsFromAnki(parsed, targetLang, fieldIndices(form))
    if (list.words.length === 0) return fail(c, 422, 'no words found in that deck')
    return c.json(await startImport({ deps, user, form, parsed, targetLang, list, planner }), 201)
  } catch (err) {
    return fail(c, 502, (err as Error).message)
  }
}

function kindOf(form: FormData): string {
  return String(form.get('kind') ?? '')
    .trim()
    .toLowerCase()
}

interface GrammarReq {
  deps: Deps
  user: { id: UserId; nativeLang: string }
  form: FormData
  parsed: Parsed
  targetLang: string
}

function grammarImport(c: Context<AppEnv>, req: GrammarReq) {
  const entries = grammarFromAnki(req.parsed, req.targetLang, fieldIndices(req.form))
  if (entries.length === 0) return fail(c, 422, 'no grammar points found in that deck')
  const created = createGrammarDeck(req.deps.db, req.user.id, grammarOpts(req, entries))
  return startExamples(req, created).then((building) =>
    c.json(grammarReply(req, created, building), 201),
  )
}

async function startExamples(req: GrammarReq, created: GrammarDeckResult): Promise<boolean> {
  const known = knownWordsFor(req.deps.db, req.user.id, req.targetLang)
  const planner = await plannerFor(req.deps, req.user.id)
  if (!planner || known.size < 2) return false
  updateDeckSettings(req.deps.db, created.deckId, { building: true, cursor: 0 })
  startGrammarExamples(req.deps.db, req.user.id, created.deckId, planner, [...known])
  return true
}

function grammarOpts(req: GrammarReq, entries: GrammarEntry[]): GrammarDeckOptions {
  const { form, user, targetLang, parsed } = req
  return {
    name: String(form.get('name') ?? '').trim() || parsed.name || 'Imported grammar',
    sourceLang: String(form.get('sourceLang') ?? user.nativeLang ?? 'en'),
    targetLang,
    entries,
    readingScript: parseInstruction(String(form.get('instruction') ?? ''), targetLang)
      .readingScript,
    sourceLabel: parsed.name,
  }
}

function grammarReply(req: GrammarReq, created: GrammarDeckResult, building: boolean) {
  return {
    deck: deckView(getDeck(req.deps.db, created.deckId)!),
    deckId: created.deckId,
    name: created.name,
    cardCount: created.cardCount,
    source: req.parsed.name ?? 'uploaded deck',
    newWords: [],
    words: created.cardCount,
    fields: [],
    building,
  }
}

interface ImportReq {
  deps: Deps
  user: { id: UserId; nativeLang: string }
  form: FormData
  parsed: Parsed
  targetLang: string
  list: AnkiList
  planner: Planner
}

function targetLangOf(form: FormData, parsed: Parsed): string {
  const requested = String(form.get('targetLang') ?? '').trim()
  return requested || detectLanguage(parsed) || 'zh'
}

interface ImportSetup {
  created: Built
  instruction: string
  rules: Rules
  sourceLang: string
  count: number
}

async function prepareImport(req: ImportReq): Promise<ImportSetup> {
  const { deps, user, form, parsed, targetLang, list } = req
  const sourceLang = String(form.get('sourceLang') ?? user.nativeLang ?? 'en')
  const count = requestedCount(form, list.words.length)
  const name = String(form.get('name') ?? '').trim() || parsed.name || 'Imported deck'
  const instruction = rememberInstruction(deps, user.id, form, name)
  const args = shellArgs(req, { instruction, targetLang, sourceLang, count, name })
  const created = await createDeckForBuild(deps.db, user.id, args)
  return {
    created,
    instruction,
    rules: parseInstruction(instruction, targetLang),
    sourceLang,
    count,
  }
}

interface ShellArgs {
  instruction: string
  targetLang: string
  sourceLang: string
  count: number
  name: string
}

function shellArgs(req: ImportReq, a: ShellArgs): Parameters<typeof createDeckForBuild>[2] {
  return {
    instruction: a.instruction,
    targetLang: a.targetLang,
    sourceLang: a.sourceLang,
    count: a.count,
    name: a.name,
    words: req.list.words,
    sourceLabel: req.parsed.name ?? 'uploaded deck',
    fetcher: req.deps.fetcher,
    planner: req.planner!,
  }
}

async function startImport(req: ImportReq) {
  const setup = await prepareImport(req)
  const { deps, user, parsed, list } = req
  updateDeckSettings(deps.db, setup.created.deckId, {
    building: true,
    buildTotal: setup.count,
    cursor: 0,
    buildError: undefined,
    ...importRules(setup, list),
  })
  startBuildJob(req, setup)
  return importReply(deps, user.id, parsed, list, setup.created)
}

function importRules(setup: ImportSetup, list: AnkiList) {
  return {
    variant: setup.rules.variant,
    readingScript: setup.rules.readingScript,
    pitchAccent: setup.rules.pitchAccent,
    hints: buildHints(list, MAX_DECK_WORDS),
  }
}

function startBuildJob(req: ImportReq, setup: ImportSetup): void {
  const { deps, user, targetLang, list } = req
  const deckId = setup.created.deckId
  startDeckBuild(deps.db, user.id, deckId, {
    ctx: {
      instruction: setup.instruction,
      targetLang,
      sourceLang: setup.sourceLang,
      variant: setup.rules.variant,
      readingScript: setup.rules.readingScript,
      pitchAccent: setup.rules.pitchAccent,
      hints: buildHints(list, setup.count),
    },
    opts: { words: list.words, count: setup.count, knownWords: [], startStep: 0 },
    planner: req.planner!,
    base: { onFinish: () => deps.audio?.enqueueDeck(user.id, deckId) },
  })
}

function importReply(deps: Deps, userId: UserId, parsed: Parsed, list: AnkiList, created: Built) {
  return {
    deck: deckView(getDeck(deps.db, created.deckId)!),
    deckId: created.deckId,
    name: created.name,
    cardCount: 0,
    source: parsed.name ?? 'uploaded deck',
    newWords: [],
    words: list.words.length,
    fields: list.fields,
    building: true,
  }
}

function fieldIndices(form: FormData) {
  const index = (name: string): number | undefined => {
    const raw = form.get(name)
    return raw != null && String(raw) !== '' ? Number(raw) : undefined
  }
  return {
    wordField: index('wordField'),
    readingField: index('readingField'),
    meaningField: index('meaningField'),
  }
}

function requestedCount(form: FormData, total: number): number {
  const raw = String(form.get('count') ?? '').trim()
  const requested = raw === '' ? NaN : Number(raw)
  return Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), total)
    : total
}

function buildHints(
  list: AnkiList,
  count: number,
): Record<string, { reading?: string; meaning?: string }> {
  const hints: Record<string, { reading?: string; meaning?: string }> = {}
  for (const w of list.words.slice(0, count)) {
    const reading = list.readings[w]
    const meaning = list.meanings[w]
    if (reading || meaning) hints[w] = { reading, meaning }
  }
  return hints
}

function rememberInstruction(deps: Deps, userId: UserId, form: FormData, name: string): string {
  const typed = String(form.get('instruction') ?? '').trim()
  const remembered = rememberedDeckInstruction(deps.db, userId) ?? ''
  if (typed) setUserSetting(deps.db, userId, DECK_INSTRUCTION_KEY, typed)
  return (
    typed ||
    remembered ||
    `Build a deck from the imported deck "${name}": introduce every word in the deck's order, and weave in sentence cards built from the words already introduced, plus grammar cards that use them.`
  )
}
