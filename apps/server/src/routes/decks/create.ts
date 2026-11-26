import type { Context } from 'hono'
import type { App, AppEnv, Deps } from '../../context'
import { getDeck, setUserSetting, type PublicUser } from '../../db/repo'
import { buildDeck, parseInstruction } from '../../deck/generate'
import { pathDeckName, pathInstruction, pathWords, PATH_BATCH } from '../../deck/path'
import { plannerFor, reviewerFor } from '../../deck/planner'
import type { Planner } from '../../deck/plan'
import { DECK_INSTRUCTION_KEY } from '../../deck/settings'
import { bool, jsonBody, num, oneOf, str, strArray } from '../body'
import { deckView } from './view'
import { fail, needKey } from '../errors'

interface CreateBody {
  instruction?: string
  name?: string
  targetLang?: string
  sourceLang?: string
  topic?: string
  count?: number
  kind?: 'path' | 'custom'
  variant?: 'traditional' | 'simplified'
  readingScript?: string
  showReadings?: boolean
  disabledExercises?: string[]
  pitchAccent?: boolean
}

function readCreateBody(body: Record<string, unknown>): CreateBody {
  return {
    instruction: str(body, 'instruction'),
    name: str(body, 'name'),
    targetLang: str(body, 'targetLang'),
    sourceLang: str(body, 'sourceLang'),
    topic: str(body, 'topic'),
    count: num(body, 'count'),
    kind: oneOf(body, 'kind', ['path', 'custom'] as const),
    variant: oneOf(body, 'variant', ['traditional', 'simplified'] as const),
    readingScript: str(body, 'readingScript'),
    showReadings: bool(body, 'showReadings'),
    disabledExercises: strArray(body, 'disabledExercises'),
    pitchAccent: bool(body, 'pitchAccent'),
  }
}

export function registerDeckCreate(app: App) {
  app.post('/api/decks', async (c) => {
    const deps = c.get('deps')
    const body = readCreateBody(await jsonBody(c))
    if (body.kind === 'custom' || body.instruction?.trim())
      return createFromInstruction(c, deps, body)
    return createFromPath(c, deps, body)
  })
}

async function createFromPath(c: Context<AppEnv>, deps: Deps, body: CreateBody) {
  const user = c.get('user')!
  const planner = await plannerFor(deps, user.id)
  if (!planner) return needKey(c)
  try {
    const built = await buildDeck(deps.db, user.id, await pathBuild(deps, user, body, planner))
    deps.audio?.enqueueDeck(user.id, built.deckId)
    return c.json({ deck: deckView(getDeck(deps.db, built.deckId)!), ...built }, 201)
  } catch (err) {
    return fail(c, 502, (err as Error).message)
  }
}

type DeckBuildArgs = Parameters<typeof buildDeck>[2]

type PathIdentity = Pick<
  DeckBuildArgs,
  | 'kind'
  | 'name'
  | 'targetLang'
  | 'sourceLang'
  | 'variant'
  | 'readingScript'
  | 'showReadings'
  | 'disabledExercises'
  | 'pitchAccent'
>

type PathRun = Pick<DeckBuildArgs, 'instruction' | 'sourceLabel' | 'count' | 'fetcher'>

async function pathBuild(
  deps: Deps,
  user: PublicUser,
  body: CreateBody,
  planner: Planner,
): Promise<DeckBuildArgs> {
  const targetLang = body.targetLang ?? 'zh'
  const parsed = parseInstruction('', targetLang)
  const words = await pathVocabulary(deps, body, targetLang, parsed)
  const settings = { ...pathIdentity(body, user, targetLang, parsed), ...pathRun(deps, targetLang) }
  return { ...settings, words, planner, reviewer: await reviewerFor(deps, user.id) }
}

async function pathVocabulary(
  deps: Deps,
  body: CreateBody,
  targetLang: string,
  parsed: ReturnType<typeof parseInstruction>,
): Promise<string[]> {
  const words = await pathWords(targetLang, {
    variant: body.variant ?? parsed.variant,
    fetcher: deps.fetcher,
  })
  if (words.length === 0) throw new Error(`no word list for ${targetLang}`)
  return words
}

function pathRun(deps: Deps, targetLang: string): PathRun {
  return {
    instruction: pathInstruction(targetLang),
    sourceLabel: 'frequency path',
    count: PATH_BATCH,
    fetcher: deps.fetcher,
  }
}

function pathIdentity(
  body: CreateBody,
  user: PublicUser,
  targetLang: string,
  parsed: ReturnType<typeof parseInstruction>,
): PathIdentity {
  return {
    kind: 'path',
    name: body.name?.trim() || pathDeckName(targetLang),
    targetLang,
    sourceLang: body.sourceLang ?? user.nativeLang ?? 'en',
    variant: body.variant ?? parsed.variant,
    readingScript: body.readingScript ?? parsed.readingScript,
    showReadings: body.showReadings,
    disabledExercises: body.disabledExercises,
    pitchAccent: body.pitchAccent ?? parsed.pitchAccent,
  }
}

async function createFromInstruction(c: Context<AppEnv>, deps: Deps, body: CreateBody) {
  const user = c.get('user')!
  const planner = await plannerFor(deps, user.id)
  if (!planner) return needKey(c)
  const reviewer = await reviewerFor(deps, user.id)
  const instruction = body.instruction!.trim()
  try {
    const built = await buildDeck(deps.db, user.id, {
      ...instructionArgs({ body, instruction, deps, planner }),
      targetLang: body.targetLang ?? 'zh',
      sourceLang: body.sourceLang ?? user.nativeLang ?? 'en',
      reviewer,
    })
    setUserSetting(deps.db, user.id, DECK_INSTRUCTION_KEY, instruction)
    deps.audio?.enqueueDeck(user.id, built.deckId)
    return c.json({ deck: deckView(getDeck(deps.db, built.deckId)!), ...built }, 201)
  } catch (err) {
    return fail(c, 502, (err as Error).message)
  }
}

interface ArgsInput {
  body: CreateBody
  instruction: string
  deps: Deps
  planner: Planner
}

function instructionArgs(input: ArgsInput): Omit<DeckBuildArgs, 'targetLang' | 'sourceLang'> {
  const { body, instruction, deps, planner } = input
  const parsed = parseInstruction(instruction, body.targetLang ?? 'zh')
  return {
    instruction,
    topic: body.topic,
    count: body.count,
    name: body.name,
    showReadings: body.showReadings,
    disabledExercises: body.disabledExercises,
    fetcher: deps.fetcher,
    planner,
    variant: body.variant ?? parsed.variant,
    readingScript: body.readingScript ?? parsed.readingScript,
    pitchAccent: body.pitchAccent ?? parsed.pitchAccent,
  }
}
