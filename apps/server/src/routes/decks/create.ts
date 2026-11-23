/**
 * `POST /api/decks` — create a deck (docs/DESIGN.md §13.7, §12.4).
 *
 * Three paths: an `instruction` (the normal one) builds the deck from a pulled
 * frequency list with the card templates; a plain `topic` falls back to a
 * one-shot vocabulary generation; no body creates an empty deck.
 */

import type { Context } from 'hono'
import type { App, AppEnv, Deps } from '../../context'
import { addCard, createDeck, getDeck, getRoles, setUserSetting } from '../../db/repo'
import { buildDeck, parseInstruction } from '../../deck/generate'
import { plannerFor } from '../../deck/planner'
import type { Planner } from '../../deck/plan'
import { DECK_INSTRUCTION_KEY } from '../../deck/settings'
import { roleReasoning } from '../../env'
import { OpenRouter } from '../../llm/openrouter'
import { MANDARIN_RULE } from '../../llm/prompts'
import { resolveUserKey } from '../../llm/userkey'
import { readingsFor } from '../../seed/service'
import { deckView } from './view'

const LANG_LABEL: Record<string, string> = {
  zh: 'Mandarin Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
}

const DECK_SCHEMA = {
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
        required: ['front', 'back', 'reading'],
        additionalProperties: false,
      },
    },
  },
  required: ['cards'],
  additionalProperties: false,
}

interface CreateBody {
  instruction?: string
  name?: string
  targetLang?: string
  sourceLang?: string
  level?: string
  topic?: string
  count?: number
  variant?: 'traditional' | 'simplified'
  readingScript?: string
  showReadings?: boolean
  disabledExercises?: string[]
  pitchAccent?: boolean
}

export function registerDeckCreate(app: App) {
  app.post('/api/decks', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as CreateBody
    if (body.instruction?.trim()) return createFromInstruction(c, deps, body)
    if (body.topic?.trim()) return createFromTopic(c, deps, body)
    const deck = createDeck(deps.db, user.id, {
      name: body.name?.trim() || 'My deck',
      sourceLang: body.sourceLang ?? user.nativeLang ?? 'en',
      targetLang: body.targetLang ?? user.targetLang ?? 'zh',
      level: body.level,
    })
    return c.json({ deck, count: 0 }, 201)
  })
}

/** The normal path: build the deck from an instruction + a real frequency list. */
async function createFromInstruction(c: Context<AppEnv>, deps: Deps, body: CreateBody) {
  const user = c.get('user')!
  const planner = await plannerFor(deps, user.id)
  if (!planner) return c.json({ error: 'No OpenRouter key — add one in Settings.' }, 502)
  const instruction = body.instruction!.trim()
  try {
    const built = await buildDeck(deps.db, user.id, {
      ...instructionArgs({ body, instruction, deps, planner }),
      targetLang: body.targetLang ?? user.targetLang ?? 'zh',
      sourceLang: body.sourceLang ?? user.nativeLang ?? 'en',
    })
    // The prompt is the deck's constitution: remember it so every later deck
    // (including imports and growth batches) starts from it.
    setUserSetting(deps.db, user.id, DECK_INSTRUCTION_KEY, instruction)
    deps.audio?.enqueueDeck(user.id, built.deckId)
    return c.json({ deck: deckView(getDeck(deps.db, built.deckId, user.id)!), ...built }, 201)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502)
  }
}

type DeckBuildArgs = Parameters<typeof buildDeck>[2]

interface ArgsInput {
  body: CreateBody
  instruction: string
  deps: Deps
  planner: Planner
}

/** The deck-building options, with the instruction parsed for its rules. */
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

/** Legacy: one-shot vocabulary generation from a topic, no frequency list. */
async function createFromTopic(c: Context<AppEnv>, deps: Deps, body: CreateBody) {
  const user = c.get('user')!
  const key = await resolveUserKey(deps, user.id)
  if (!key) return c.json({ error: 'No OpenRouter key — add one in Settings.' }, 502)
  const targetLang = body.targetLang ?? user.targetLang ?? 'zh'
  const sourceLang = body.sourceLang ?? user.nativeLang ?? 'en'
  try {
    const cards = await generateTopicCards(deps, user.id, key, body, targetLang)
    const deck = createTopicDeck(deps, user.id, body, sourceLang, targetLang)
    addTopicCards({ deps, userId: user.id, deckId: deck.id, sourceLang, targetLang, cards })
    deps.audio?.enqueueDeck(user.id, deck.id)
    return c.json({ deck, count: cards.length }, 201)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502)
  }
}

function createTopicDeck(
  deps: Deps,
  userId: string,
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

interface TopicCard {
  front: string
  back: string
  reading: string
  kana?: string
}

async function generateTopicCards(
  deps: Deps,
  userId: string,
  key: string,
  body: CreateBody,
  targetLang: string,
): Promise<TopicCard[]> {
  const or = new OpenRouter(key, deps.or.baseUrl)
  const { json } = await or.chatJSON<{ cards: TopicCard[] }>({
    model: getRoles(deps.db, userId, deps.defaults).generator,
    reasoning: roleReasoning.generator,
    schemaName: 'deck',
    schema: DECK_SCHEMA,
    messages: topicMessages(body, targetLang),
  })
  return json.cards
}

function topicMessages(
  body: CreateBody,
  targetLang: string,
): { role: 'system' | 'user'; content: string }[] {
  const count = Math.min(Math.max(body.count ?? 20, 5), 50)
  const lang = LANG_LABEL[targetLang] ?? targetLang
  const topic = body.topic!.trim()
  const level = body.level ?? 'beginner'
  return [
    {
      role: 'system',
      content: `You generate vocabulary decks for a language learner. Be accurate and level-appropriate.\n${MANDARIN_RULE}`,
    },
    {
      role: 'user',
      content: `Create ${count} ${lang} vocabulary cards (level ${level}) about "${topic}". "front" is English, "back" is the ${lang} text. ${readingRule(targetLang)}`,
    },
  ]
}

/** The reading convention for the generated cards, by target language. */
function readingRule(targetLang: string): string {
  return targetLang === 'ja'
    ? '"reading" is romaji and "kana" is the hiragana reading (furigana).'
    : '"back" must be in Traditional characters (繁體字), never Simplified. "reading" is pinyin with tone marks — it is used only to derive Zhuyin and is never shown to the learner.'
}

interface TopicCardsCtx {
  deps: Deps
  userId: string
  deckId: string
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
      readings: readingsFor(ctx.targetLang, cd.reading, cd.kana),
      origin: 'llm',
    })
  }
}
