import {
  addCard,
  createDeck,
  getDeck,
  getRoles,
  listCards,
  listDecks,
  updateDeckSettings,
} from '../db/repo'
import { readApkg } from '../anki/parse'
import { inspectAnki, wordsFromAnki } from '../anki/words'
import { buildDeck, growDeck, parseInstruction } from '../deck/generate'
import { llmPlanner, type Planner } from '../deck/plan'
import { roleReasoning } from '../env'
import { OpenRouter } from '../llm/openrouter'
import { MANDARIN_RULE } from '../llm/prompts'
import { resolveUserKey } from '../llm/userkey'
import { readingsFor } from '../seed/service'
import type { App, Deps } from '../context'

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

/** The planner for this user: a test override, or an OpenRouter-backed one. */
async function plannerFor(deps: Deps, userId: string): Promise<Planner | undefined> {
  if (deps.planner) return deps.planner
  const key = await resolveUserKey(deps, userId)
  if (!key) return undefined
  const model = getRoles(deps.db, userId, deps.defaults).generator
  return llmPlanner(new OpenRouter(key, deps.or.baseUrl), model, roleReasoning.generator)
}

export function registerDecks(app: App) {
  app.get('/api/decks', (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    return c.json({ decks: listDecks(deps.db, user.id) })
  })

  app.get('/api/decks/:id/cards', (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const deck = getDeck(deps.db, c.req.param('id'), user.id)
    if (!deck) return c.json({ error: 'not found' }, 404)
    return c.json({ deck, cards: listCards(deps.db, user.id, deck.id) })
  })

  /**
   * Create a deck. With an `instruction` (the normal path) the deck is generated
   * from a pulled frequency list using the card templates. A plain `topic` falls
   * back to a one-shot vocabulary generation; no body creates an empty deck.
   */
  app.post('/api/decks', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as {
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
    }
    const targetLang = body.targetLang ?? user.targetLang ?? 'zh'
    const sourceLang = body.sourceLang ?? user.nativeLang ?? 'en'

    // --- generated from an instruction + a real frequency list ----------------
    if (body.instruction?.trim()) {
      const planner = await plannerFor(deps, user.id)
      if (!planner) return c.json({ error: 'No OpenRouter key — add one in Settings.' }, 502)
      const parsed = parseInstruction(body.instruction, targetLang)
      try {
        const built = await buildDeck(deps.db, user.id, {
          instruction: body.instruction.trim(),
          targetLang,
          sourceLang,
          topic: body.topic,
          count: body.count,
          name: body.name,
          variant: body.variant ?? parsed.variant,
          readingScript: body.readingScript ?? parsed.readingScript,
          showReadings: body.showReadings,
          disabledExercises: body.disabledExercises,
          fetcher: deps.fetcher,
          planner,
        })
        return c.json({ deck: getDeck(deps.db, built.deckId, user.id), ...built }, 201)
      } catch (err) {
        return c.json({ error: (err as Error).message }, 502)
      }
    }

    // --- legacy: one-shot vocabulary generation from a topic ------------------
    if (body.topic?.trim()) {
      const key = await resolveUserKey(deps, user.id)
      if (!key) return c.json({ error: 'No OpenRouter key — add one in Settings.' }, 502)
      const count = Math.min(Math.max(body.count ?? 20, 5), 50)
      const or = new OpenRouter(key, deps.or.baseUrl)
      try {
        const { json } = await or.chatJSON<{
          cards: { front: string; back: string; reading: string; kana?: string }[]
        }>({
          model: getRoles(deps.db, user.id, deps.defaults).generator,
          reasoning: roleReasoning.generator,
          schemaName: 'deck',
          schema: DECK_SCHEMA,
          messages: [
            {
              role: 'system',
              content: `You generate vocabulary decks for a language learner. Be accurate and level-appropriate.\n${MANDARIN_RULE}`,
            },
            {
              role: 'user',
              content: `Create ${count} ${LANG_LABEL[targetLang] ?? targetLang} vocabulary cards (level ${body.level ?? 'beginner'}) about "${body.topic}". "front" is English, "back" is the ${LANG_LABEL[targetLang] ?? targetLang} text. ${
                targetLang === 'ja'
                  ? '"reading" is romaji and "kana" is the hiragana reading (furigana).'
                  : '"back" must be in Traditional characters (繁體字), never Simplified. "reading" is pinyin with tone marks — it is used only to derive Zhuyin and is never shown to the learner.'
              }`,
            },
          ],
        })
        const deck = createDeck(deps.db, user.id, {
          name: body.name?.trim() || `AI: ${body.topic}`,
          sourceLang,
          targetLang,
          level: body.level,
          description: `Generated from "${body.topic}"`,
        })
        for (const cd of json.cards) {
          addCard(deps.db, user.id, {
            deckId: deck.id,
            sourceLang,
            targetLang,
            front: cd.front,
            back: cd.back,
            readings: readingsFor(targetLang, cd.reading, cd.kana),
            origin: 'llm',
          })
        }
        return c.json({ deck, count: json.cards.length }, 201)
      } catch (err) {
        return c.json({ error: (err as Error).message }, 502)
      }
    }

    const deck = createDeck(deps.db, user.id, {
      name: body.name?.trim() || 'My deck',
      sourceLang,
      targetLang,
      level: body.level,
    })
    return c.json({ deck, count: 0 }, 201)
  })

  /**
   * Inspect an uploaded Anki `.apkg` *before* importing: returns its field names
   * and a preview, so the learner can say which field is the real word instead
   * of the server guessing.
   */
  app.post('/api/decks/inspect', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'an .apkg file is required' }, 400)
    const targetLang = String(form.get('targetLang') ?? user.targetLang ?? 'zh')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const parsed = await readApkg(bytes)
      return c.json(inspectAnki(parsed, targetLang))
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502)
    }
  })

  /**
   * Import an Anki `.apkg`: the words come from the learner's own deck instead
   * of a frequency list, and the templates write the cards from them. The
   * word/reading/meaning fields are chosen by the caller (`/inspect` previews them).
   */
  app.post('/api/decks/import', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'an .apkg file is required' }, 400)
    const targetLang = String(form.get('targetLang') ?? user.targetLang ?? 'zh')
    const sourceLang = String(form.get('sourceLang') ?? user.nativeLang ?? 'en')
    const count = Math.min(Math.max(Number(form.get('count') ?? 20) || 20, 1), 50)
    const fieldIndex = (name: string): number | undefined => {
      const raw = form.get(name)
      return raw != null && String(raw) !== '' ? Number(raw) : undefined
    }
    const wordField = fieldIndex('wordField')
    const readingField = fieldIndex('readingField')
    const meaningField = fieldIndex('meaningField')

    const planner = await plannerFor(deps, user.id)
    if (!planner) return c.json({ error: 'No OpenRouter key — add one in Settings.' }, 502)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const parsed = await readApkg(bytes)
      const list = wordsFromAnki(parsed, targetLang, { wordField, readingField, meaningField })
      if (list.words.length === 0) return c.json({ error: 'no words found in that deck' }, 422)

      const hints: Record<string, { reading?: string; meaning?: string }> = {}
      for (const w of list.words.slice(0, count)) {
        const reading = list.readings[w]
        const meaning = list.meanings[w]
        if (reading || meaning) hints[w] = { reading, meaning }
      }
      const name = String(form.get('name') ?? '').trim() || parsed.name || 'Imported deck'
      const instruction =
        String(form.get('instruction') ?? '').trim() || `Build a deck from the imported deck "${name}"`
      const rules = parseInstruction(instruction, targetLang)
      const built = await buildDeck(deps.db, user.id, {
        instruction,
        targetLang,
        sourceLang,
        count,
        name,
        words: list.words,
        sourceLabel: parsed.name ?? 'uploaded deck',
        hints,
        variant: rules.variant,
        readingScript: rules.readingScript,
        fetcher: deps.fetcher,
        planner,
      })
      return c.json(
        { deck: getDeck(deps.db, built.deckId, user.id), ...built, words: list.words.length, fields: list.fields },
        201,
      )
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502)
    }
  })

  /** Grow a deck organically: add another n+1 batch (optionally on a topic). */
  app.post('/api/decks/:id/grow', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const deckId = c.req.param('id')
    if (!getDeck(deps.db, deckId, user.id)) return c.json({ error: 'not found' }, 404)
    const body = (await c.req.json().catch(() => ({}))) as {
      topic?: string
      count?: number
    }
    const planner = await plannerFor(deps, user.id)
    if (!planner) return c.json({ error: 'No OpenRouter key — add one in Settings.' }, 502)
    try {
      const built = await growDeck(deps.db, user.id, deckId, {
        topic: body.topic,
        count: body.count,
        fetcher: deps.fetcher,
        planner,
      })
      return c.json({ deck: getDeck(deps.db, deckId, user.id), ...built })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502)
    }
  })

  /** Update a deck's own rules (ruby/reading override, variant, toggles). */
  app.patch('/api/decks/:id', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const deckId = c.req.param('id')
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string
      settings?: {
        showReadings?: boolean
        readingScript?: string
        variant?: 'traditional' | 'simplified'
        disabledExercises?: string[]
      }
    }
    if (!getDeck(deps.db, deckId, user.id)) return c.json({ error: 'not found' }, 404)
    const settings = body.settings
      ? updateDeckSettings(deps.db, deckId, user.id, body.settings)
      : undefined
    return c.json({ deck: getDeck(deps.db, deckId, user.id), settings })
  })
}
