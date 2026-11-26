import type { UserId, DeckId } from '../../ids'
import type { Context } from 'hono'
import type { App, AppEnv, Deps } from '../../context'
import {
  addCard,
  createDeck,
  getDeck,
  getRoles,
  setUserSetting,
  type PublicUser,
} from '../../db/repo'
import { inTransaction } from '../../db/repo/helpers'
import { buildDeck, parseInstruction } from '../../deck/generate'
import { pathDeckName, pathInstruction, pathWords, PATH_BATCH } from '../../deck/path'
import { plannerFor, reviewerFor } from '../../deck/planner'
import type { Planner } from '../../deck/plan'
import { DECK_INSTRUCTION_KEY } from '../../deck/settings'
import { roleReasoning } from '../../env'
import { OpenRouter } from '../../llm/openrouter'
import { langName } from '../../llm/prompts'
import { resolveUserKey } from '../../llm/userkey'
import { readingsFor } from '../../seed/service'
import { bool, jsonBody, num, oneOf, str, strArray } from '../body'
import { deckView } from './view'
import { fail, needKey } from '../errors'

interface CreateBody {
  instruction?: string
  name?: string
  targetLang?: string
  sourceLang?: string
  level?: string
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
    level: str(body, 'level'),
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
    const user = c.get('user')!
    const body = readCreateBody(await jsonBody(c))
    if (body.kind === 'path') return createFromPath(c, deps, body)
    if (body.instruction?.trim()) return createFromInstruction(c, deps, body)
    if (body.topic?.trim()) return createFromTopic(c, deps, body)
    const deck = createDeck(deps.db, user.id, {
      name: body.name?.trim() || 'My deck',
      sourceLang: body.sourceLang ?? user.nativeLang ?? 'en',
      targetLang: body.targetLang ?? 'zh',
      level: body.level,
    })
    return c.json({ deck, count: 0 }, 201)
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

type DeckBuildArgs = Parameters<typeof buildDeck>[2]

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

async function createFromTopic(c: Context<AppEnv>, deps: Deps, body: CreateBody) {
  const user = c.get('user')!
  const key = await resolveUserKey(deps, user.id)
  if (!key) return needKey(c)
  const targetLang = body.targetLang ?? 'zh'
  const sourceLang = body.sourceLang ?? user.nativeLang ?? 'en'
  try {
    const cards = usableCards(await generateTopicCards(deps, user.id, key, body, targetLang))
    if (cards.length === 0) return fail(c, 502, 'the model returned no usable cards')
    const deck = saveTopicDeck(deps, body, { userId: user.id, sourceLang, targetLang, cards })
    deps.audio?.enqueueDeck(user.id, deck.id)
    return c.json({ deck, count: cards.length }, 201)
  } catch (err) {
    return fail(c, 502, (err as Error).message)
  }
}

function saveTopicDeck(deps: Deps, body: CreateBody, ctx: Omit<TopicCardsCtx, 'deps' | 'deckId'>) {
  return inTransaction(deps.db, (tx) => {
    const scoped = { ...deps, db: tx }
    const deck = createTopicDeck(scoped, ctx.userId, body, ctx.sourceLang, ctx.targetLang)
    addTopicCards({ ...ctx, deps: scoped, deckId: deck.id })
    return deck
  })
}

function createTopicDeck(
  deps: Deps,
  userId: UserId,
  body: CreateBody,
  sourceLang: string,
  targetLang: string,
) {
  const topic = body.topic!.trim()
  return createDeck(deps.db, userId, {
    name: body.name?.trim() || `AI: ${topic}`,
    sourceLang,
    targetLang,
    level: body.level,
    description: `Generated from "${topic}"`,
  })
}

function usableCards(cards: unknown): TopicCard[] {
  if (!Array.isArray(cards)) return []
  return cards.filter(
    (c): c is TopicCard =>
      typeof c?.front === 'string' &&
      typeof c?.back === 'string' &&
      !!c.front.trim() &&
      !!c.back.trim(),
  )
}

interface TopicCard {
  front: string
  back: string
  reading: string
  kana?: string
}

async function generateTopicCards(
  deps: Deps,
  userId: UserId,
  key: string,
  body: CreateBody,
  targetLang: string,
): Promise<TopicCard[]> {
  const or = new OpenRouter(key, deps.or.baseUrl)
  const { json } = await or.chatJSON<{ cards: TopicCard[] }>({
    model: getRoles(deps.db, userId, deps.defaults).generator,
    reasoning: roleReasoning.generator,
    schemaName: 'deck',
    schema: TOPIC_SCHEMA,
    messages: topicMessages(body, targetLang),
  })
  return json.cards
}

function topicMessages(
  body: CreateBody,
  targetLang: string,
): { role: 'system' | 'user'; content: string }[] {
  const count = Math.min(Math.max(body.count ?? 20, 5), 50)
  const lang = langName(targetLang)
  const topic = body.topic!.trim()
  const level = body.level ?? 'beginner'
  const request = [
    `Write ${count} ${lang} vocabulary cards about "${topic}" for a ${level} learner.`,
    '- front: the meaning in English. Separate several senses with " / ".',
    `- back: the ${lang} word.`,
    readingRule(targetLang),
  ]
  return [
    { role: 'system', content: TOPIC_SYSTEM },
    { role: 'user', content: request.join('\n') },
  ]
}

const TOPIC_SYSTEM =
  'You write vocabulary cards for a language learner. Return only the JSON the schema asks for. ' +
  'Choose common, useful words at the requested level, one word or short set phrase per card, with no duplicates.'

const TOPIC_SCHEMA = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          front: { type: 'string' },
          back: { type: 'string' },
          reading: { type: 'string' },
          kana: { type: 'string' },
        },
        required: ['front', 'back', 'reading', 'kana'],
        additionalProperties: false,
      },
    },
  },
  required: ['cards'],
  additionalProperties: false,
}

function readingRule(targetLang: string): string {
  if (targetLang === 'ja') {
    return '- kana: the reading in hiragana. reading: the same reading in romaji.'
  }
  if (targetLang === 'zh') {
    return '- back uses Traditional characters (繁體字). reading: pinyin with tone marks. kana: an empty string.'
  }
  return '- reading and kana: empty strings.'
}

function topicReadings(targetLang: string, cd: TopicCard): Record<string, string> {
  if (targetLang !== 'zh' && targetLang !== 'ja') return {}
  return readingsFor(targetLang, cd.reading ?? '', cd.kana)
}

interface TopicCardsCtx {
  deps: Deps
  userId: UserId
  deckId: DeckId
  sourceLang: string
  targetLang: string
  cards: TopicCard[]
}

function addTopicCards(ctx: TopicCardsCtx): void {
  for (const cd of ctx.cards) {
    addCard(ctx.deps.db, ctx.userId, {
      deckId: ctx.deckId,
      sourceLang: ctx.sourceLang,
      targetLang: ctx.targetLang,
      front: cd.front,
      back: cd.back,
      readings: topicReadings(ctx.targetLang, cd),
      origin: 'llm',
    })
  }
}
