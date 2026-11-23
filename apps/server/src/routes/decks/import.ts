/**
 * Importing an Anki `.apkg` (docs/DESIGN.md §13.7).
 *
 * `/inspect` previews the file's fields so the learner says which field is the
 * word; `/import` then builds a deck from the learner's own words (the whole
 * deck by default), in the background because it is dozens of LLM calls.
 */

import type { Context } from 'hono'
import type { App, AppEnv, Deps } from '../../context'
import {
  getDeck,
  rememberedDeckInstruction,
  setUserSetting,
  updateDeckSettings,
} from '../../db/repo'
import { detectLanguage, inspectAnki, wordsFromAnki } from '../../anki/words'
import { readApkg } from '../../anki/parse'
import { createDeckForBuild, parseInstruction, startDeckBuild } from '../../deck/generate'
import { plannerFor } from '../../deck/planner'
import { DECK_INSTRUCTION_KEY } from '../../deck/settings'
import { deckView } from './view'

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
  const user = c.get('user')!
  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return c.json({ error: 'an .apkg file is required' }, 400)
  try {
    const parsed = await readApkg(new Uint8Array(await file.arrayBuffer()))
    return c.json(inspectAnki(parsed, targetLangOf(form, parsed, user.targetLang)))
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502)
  }
}

async function importHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return c.json({ error: 'an .apkg file is required' }, 400)
  const planner = await plannerFor(deps, user.id)
  if (!planner) return c.json({ error: 'No OpenRouter key — add one in Settings.' }, 502)
  try {
    const parsed = await readApkg(new Uint8Array(await file.arrayBuffer()))
    const targetLang = targetLangOf(form, parsed, user.targetLang)
    const list = wordsFromAnki(parsed, targetLang, fieldIndices(form))
    if (list.words.length === 0) return c.json({ error: 'no words found in that deck' }, 422)
    const payload = await startImport({ deps, user, form, parsed, targetLang, list, planner })
    return c.json(payload, 201)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502)
  }
}

/** Everything an import needs once the upload has been parsed. */
interface ImportReq {
  deps: Deps
  user: { id: string; nativeLang: string }
  form: FormData
  parsed: Parsed
  targetLang: string
  list: AnkiList
  planner: Planner
}

/** The deck's own script decides the language unless the caller picked one. */
function targetLangOf(form: FormData, parsed: Parsed, userTarget: string | null): string {
  const requested = String(form.get('targetLang') ?? '').trim()
  return requested || detectLanguage(parsed) || userTarget || 'zh'
}

/** Creates the deck shell with its instruction and parsed rules. */
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

/** The options `createDeckForBuild` takes for a fresh imported deck shell. */
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

/** Marks the deck building and starts the background generation job. */
async function startImport(req: ImportReq) {
  const setup = await prepareImport(req)
  const { deps, user, parsed, list } = req
  // A full import is many LLM calls, well past Bun's request idle timeout. The UI
  // watches `settings.building` + the growth cursor.
  updateDeckSettings(deps.db, setup.created.deckId, user.id, {
    building: true,
    buildTotal: setup.count,
    cursor: 0,
    buildError: undefined,
  })
  startBuildJob(req, setup)
  return importReply(deps, user.id, parsed, list, setup.created)
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
      hints: buildHints(list, setup.count),
    },
    opts: { words: list.words, count: setup.count, knownWords: [], startStep: 0 },
    planner: req.planner!,
    base: { onFinish: () => deps.audio?.enqueueDeck(user.id, deckId) },
  })
}

function importReply(deps: Deps, userId: string, parsed: Parsed, list: AnkiList, created: Built) {
  return {
    deck: deckView(getDeck(deps.db, created.deckId, userId)!),
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

/** Which Anki field is the word / reading / meaning, when the caller chose. */
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

/** An explicit count takes that prefix; blank imports the whole word list. */
function requestedCount(form: FormData, total: number): number {
  const raw = String(form.get('count') ?? '').trim()
  const requested = raw === '' ? NaN : Number(raw)
  return Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), total)
    : total
}

/** The word -> reading/meaning hints the generator weaves the cards from. */
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

/**
 * Every deck carries the learner's prompt — typed now, or the one they already
 * gave on an earlier deck. Otherwise the generic wording asks the generator to
 * weave sentences and grammar through the imported words.
 */
function rememberInstruction(deps: Deps, userId: string, form: FormData, name: string): string {
  const typed = String(form.get('instruction') ?? '').trim()
  const remembered = rememberedDeckInstruction(deps.db, userId) ?? ''
  if (typed) setUserSetting(deps.db, userId, DECK_INSTRUCTION_KEY, typed)
  return (
    typed ||
    remembered ||
    `Build a deck from the imported deck "${name}": introduce every word in the deck's order, and weave in sentence cards built from the words already introduced, plus grammar cards that use them.`
  )
}
