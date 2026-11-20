import {
  addCard,
  createDeck,
  deleteDeck,
  getCard,
  getDeck,
  getRoles,
  listCards,
  listDecks,
  rememberedDeckInstruction,
  setUserSetting,
  updateCard,
  updateDeckSettings,
} from '../db/repo'
import { readApkg } from '../anki/parse'
import { parsePitchContour } from '@tutor/core'
import { detectLanguage, inspectAnki, wordsFromAnki } from '../anki/words'
import {
  buildDeck,
  createDeckForBuild,
  growDeck,
  parseInstruction,
  startDeckBuild,
  startDeckGrowth,
} from '../deck/generate'
import { llmPlanner, type Planner } from '../deck/plan'
import { plannerFor } from '../deck/planner'
import {
  backfillDeckPitch,
  composeFetchers,
  dictionaryFetcher,
  llmPitchFetcher,
  pitchTargets,
  type PitchFetcher,
} from '../deck/pitch'
import { DECK_INSTRUCTION_KEY, publicDeckSettings, type DeckSettings } from '../deck/settings'
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

/**
 * The pitch annotator for this user: the bundled Japanese dictionary first, and
 * the generator model for whatever the dictionary does not know. With
 * `dictionaryOnly` the model is skipped entirely, so a re-annotation is
 * deterministic and needs no key.
 */
async function pitchFetcherFor(
  deps: Deps,
  userId: string,
  targetLang: string,
  opts: { dictionaryOnly?: boolean } = {},
): Promise<PitchFetcher | undefined> {
  const dictionary = dictionaryFetcher(targetLang)
  if (deps.pitch) return composeFetchers(dictionary, deps.pitch)
  if (opts.dictionaryOnly) return dictionary
  const key = await resolveUserKey(deps, userId)
  if (!key) return targetLang === 'ja' ? dictionary : undefined
  const model = getRoles(deps.db, userId, deps.defaults).generator
  const generated = llmPitchFetcher(
    new OpenRouter(key, deps.or.baseUrl),
    model,
    roleReasoning.generator,
    targetLang,
  )
  return composeFetchers(dictionary, generated)
}

/** A deck as sent to a client — without the server-only source word list. */
function deckView<T extends { settings?: DeckSettings }>(deck: T): T {
  return deck.settings ? { ...deck, settings: publicDeckSettings(deck.settings) } : deck
}

export function registerDecks(app: App) {
  app.get('/api/decks', (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    return c.json({ decks: listDecks(deps.db, user.id).map(deckView) })
  })

  app.get('/api/decks/:id/cards', (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const deck = getDeck(deps.db, c.req.param('id'), user.id)
    if (!deck) return c.json({ error: 'not found' }, 404)
    return c.json({ deck: deckView(deck), cards: listCards(deps.db, user.id, deck.id) })
  })

  /**
   * Add a single card to a deck. With a `step` it joins that lesson — the n+1
   * group, so a new sentence card can sit beside the word it reinforces. Without
   * one it appends a fresh step at the end. Used by hand-authoring and by the
   * automatic reinforcement that fires when a card keeps lapsing.
   */
  app.post('/api/decks/:id/cards', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const deck = getDeck(deps.db, c.req.param('id'), user.id)
    if (!deck) return c.json({ error: 'not found' }, 404)
    const body = (await c.req.json().catch(() => ({}))) as {
      front?: string
      back?: string
      type?: string
      reading?: string
      step?: number
      payload?: Record<string, unknown>
    }
    const front = body.front?.trim()
    const back = body.back?.trim()
    if (!front || !back) return c.json({ error: 'front and back are required' }, 400)
    const template = body.type?.trim() || 'vocab'
    const cards = listCards(deps.db, user.id, deck.id)
    const maxStep = cards.reduce(
      (m, card) => Math.max(m, typeof card.payload?.step === 'number' ? card.payload.step : 0),
      0,
    )
    const step =
      typeof body.step === 'number' && Number.isFinite(body.step)
        ? Math.max(1, Math.round(body.step))
        : maxStep + 1
    const reading = body.reading?.trim()
    const readings: Record<string, string> = !reading
      ? {}
      : deck.targetLang === 'ja'
        ? { kana: reading }
        : deck.targetLang === 'zh' || deck.targetLang === 'yue'
          ? { zhuyin: reading }
          : { reading }
    const card = addCard(deps.db, user.id, {
      deckId: deck.id,
      type: template as never,
      sourceLang: deck.sourceLang,
      targetLang: deck.targetLang,
      front,
      back,
      readings,
      tags: [deck.targetLang, template],
      payload: { ...(body.payload ?? {}), template, step },
      origin: 'manual',
    })
    return c.json({ card: getCard(deps.db, card.id, user.id), step }, 201)
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
      pitchAccent?: boolean
    }
    const targetLang = body.targetLang ?? user.targetLang ?? 'zh'
    const sourceLang = body.sourceLang ?? user.nativeLang ?? 'en'

    // --- generated from an instruction + a real frequency list ----------------
    if (body.instruction?.trim()) {
      const instruction = body.instruction.trim()
      const planner = await plannerFor(deps, user.id)
      if (!planner) return c.json({ error: 'No OpenRouter key — add one in Settings.' }, 502)
      const parsed = parseInstruction(instruction, targetLang)
      try {
        const built = await buildDeck(deps.db, user.id, {
          instruction,
          targetLang,
          sourceLang,
          topic: body.topic,
          count: body.count,
          name: body.name,
          variant: body.variant ?? parsed.variant,
          readingScript: body.readingScript ?? parsed.readingScript,
          showReadings: body.showReadings,
          disabledExercises: body.disabledExercises,
          pitchAccent: body.pitchAccent ?? parsed.pitchAccent,
          fetcher: deps.fetcher,
          planner,
        })
        // The prompt is the deck's constitution: remember it so every later
        // deck (including imports and growth batches) starts from it.
        setUserSetting(deps.db, user.id, DECK_INSTRUCTION_KEY, instruction)
        return c.json({ deck: deckView(getDeck(deps.db, built.deckId, user.id)!), ...built }, 201)
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
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const parsed = await readApkg(bytes)
      const targetLang =
        String(form.get('targetLang') ?? '').trim() ||
        detectLanguage(parsed) ||
        user.targetLang ||
        'zh'
      return c.json(inspectAnki(parsed, targetLang))
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502)
    }
  })

  /**
   * Import an Anki `.apkg`: the words come from the learner's own deck instead
   * of a frequency list, and the templates write the cards from them. The whole
   * deck is imported by default — its ordered words are the starter, and the
   * generator weaves sentence/grammar cards through them — and it fills in the
   * background because that is dozens of LLM calls. An explicit `count` imports
   * just a prefix. The word/reading/meaning fields are chosen by the caller
   * (`/inspect` previews them).
   */
  app.post('/api/decks/import', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'an .apkg file is required' }, 400)
    const requestedLang = String(form.get('targetLang') ?? '').trim()
    const sourceLang = String(form.get('sourceLang') ?? user.nativeLang ?? 'en')
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
      // the deck's own script decides the language unless the caller picked one
      const targetLang = requestedLang || detectLanguage(parsed) || user.targetLang || 'zh'
      const list = wordsFromAnki(parsed, targetLang, { wordField, readingField, meaningField })
      if (list.words.length === 0) return c.json({ error: 'no words found in that deck' }, 422)

      // Import the whole deck by default; an explicit count takes that prefix.
      const rawCount = String(form.get('count') ?? '').trim()
      const requested = rawCount === '' ? NaN : Number(rawCount)
      const count =
        Number.isFinite(requested) && requested > 0
          ? Math.min(Math.floor(requested), list.words.length)
          : list.words.length

      const hints: Record<string, { reading?: string; meaning?: string }> = {}
      for (const w of list.words.slice(0, count)) {
        const reading = list.readings[w]
        const meaning = list.meanings[w]
        if (reading || meaning) hints[w] = { reading, meaning }
      }
      const name = String(form.get('name') ?? '').trim() || parsed.name || 'Imported deck'
      const typed = String(form.get('instruction') ?? '').trim()
      const remembered = rememberedDeckInstruction(deps.db, user.id) ?? ''
      if (typed) setUserSetting(deps.db, user.id, DECK_INSTRUCTION_KEY, typed)
      // Every deck carries the learner's prompt — typed now, or the one they
      // already gave on an earlier deck. Otherwise the generic wording asks the
      // generator to weave sentences and grammar through the imported words.
      const instruction =
        typed ||
        remembered ||
        `Build a deck from the imported deck "${name}": introduce every word in the deck's order, and weave in sentence cards built from the words already introduced, plus grammar cards that use them.`
      const rules = parseInstruction(instruction, targetLang)
      const created = await createDeckForBuild(deps.db, user.id, {
        instruction,
        targetLang,
        sourceLang,
        count,
        name,
        words: list.words,
        sourceLabel: parsed.name ?? 'uploaded deck',
        fetcher: deps.fetcher,
        planner,
      })
      // Mark the deck building, then generate in the background: a full import
      // is many LLM calls, well past Bun's request idle timeout. The UI watches
      // `settings.building` + the growth cursor.
      updateDeckSettings(deps.db, created.deckId, user.id, {
        building: true,
        buildTotal: count,
        cursor: 0,
        buildError: undefined,
      })
      startDeckBuild(
        deps.db,
        user.id,
        created.deckId,
        {
          instruction,
          targetLang,
          sourceLang,
          variant: rules.variant,
          readingScript: rules.readingScript,
          hints,
        },
        { words: list.words, count, knownWords: [], startStep: 0 },
        planner,
      )
      return c.json(
        {
          deck: deckView(getDeck(deps.db, created.deckId, user.id)!),
          deckId: created.deckId,
          name: created.name,
          cardCount: 0,
          source: parsed.name ?? 'uploaded deck',
          newWords: [],
          words: list.words.length,
          fields: list.fields,
          building: true,
        },
        201,
      )
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502)
    }
  })

  /**
   * Grow a deck organically: add another n+1 batch (optionally on a topic).
   * With `{ all: true }` it finishes the deck instead — every remaining word is
   * generated in the background, so a stopped or interrupted build resumes.
   */
  app.post('/api/decks/:id/grow', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const deckId = c.req.param('id')
    if (!getDeck(deps.db, deckId, user.id)) return c.json({ error: 'not found' }, 404)
    const body = (await c.req.json().catch(() => ({}))) as {
      topic?: string
      count?: number
      all?: boolean
    }
    const planner = await plannerFor(deps, user.id)
    if (!planner) return c.json({ error: 'No OpenRouter key — add one in Settings.' }, 502)

    if (body.all) {
      try {
        const remaining = await startDeckGrowth(deps.db, user.id, deckId, {
          topic: body.topic,
          fetcher: deps.fetcher,
          planner,
        })
        return c.json(
          {
            deck: deckView(getDeck(deps.db, deckId, user.id)!),
            remaining: remaining ?? 0,
            building: (remaining ?? 0) > 0,
            newWords: [],
          },
          202,
        )
      } catch (err) {
        return c.json({ error: (err as Error).message }, 502)
      }
    }

    try {
      const built = await growDeck(deps.db, user.id, deckId, {
        topic: body.topic,
        count: body.count,
        fetcher: deps.fetcher,
        planner,
      })
      return c.json({ deck: deckView(getDeck(deps.db, deckId, user.id)!), ...built })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502)
    }
  })

  /** Delete a deck completely: cards, SRS state, history and deck chats. */
  app.delete('/api/decks/:id', (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const deckId = c.req.param('id')
    if (!getDeck(deps.db, deckId, user.id)) return c.json({ error: 'not found' }, 404)
    deleteDeck(deps.db, deckId, user.id)
    return c.json({ ok: true, deckId })
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
        pitchAccent?: boolean
      }
    }
    if (!getDeck(deps.db, deckId, user.id)) return c.json({ error: 'not found' }, 404)
    const settings = body.settings
      ? updateDeckSettings(deps.db, deckId, user.id, body.settings)
      : undefined
    return c.json({
      deck: deckView(getDeck(deps.db, deckId, user.id)!),
      settings: settings ? publicDeckSettings(settings) : undefined,
    })
  })

  /**
   * Update a card's own content. Metadata is the language-agnostic annotation
   * bag (pitch accent, radicals, …); it is merged by key so one annotation can
   * be edited without dropping the others.
   */
  app.patch('/api/decks/:id/cards/:cardId', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const deckId = c.req.param('id')
    const cardId = c.req.param('cardId')
    const card = getCard(deps.db, cardId, user.id)
    if (!card || card.deckId !== deckId) return c.json({ error: 'not found' }, 404)
    const body = (await c.req.json().catch(() => ({}))) as {
      front?: string
      back?: string
      readings?: Record<string, string>
      metadata?: Record<string, unknown>
    }
    const patch: {
      front?: string
      back?: string
      readings?: Record<string, string>
      metadata?: Record<string, unknown>
    } = {}
    if (typeof body.front === 'string') patch.front = body.front
    if (typeof body.back === 'string') patch.back = body.back
    if (body.readings && typeof body.readings === 'object') patch.readings = body.readings
    // Merge annotations by key; an explicit `null` removes one.
    if (body.metadata && typeof body.metadata === 'object') {
      const merged: Record<string, unknown> = { ...card.metadata }
      for (const [key, value] of Object.entries(body.metadata)) {
        if (value === null) delete merged[key]
        else merged[key] = value
      }
      // Keep the built-in pitch contour canonical so the UI can render it.
      if ('pitch' in merged) {
        const pitch = parsePitchContour(merged.pitch)
        if (pitch) merged.pitch = pitch
        else delete merged.pitch
      }
      patch.metadata = merged
    }
    updateCard(deps.db, cardId, user.id, patch)
    return c.json({ card: getCard(deps.db, cardId, user.id) })
  })

  /**
   * Backfill pitch-accent metadata for the deck's cards that lack it. The
   * bundled dictionary answers first (offline); the generator fills the rest.
   * With `{ force: true }` every card with a reading is re-annotated from the
   * dictionary alone — this replaces wrong contours without asking the model.
   * Returns how many cards were annotated.
   */
  app.post('/api/decks/:id/pitch', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const deckId = c.req.param('id')
    const deck = getDeck(deps.db, deckId, user.id)
    if (!deck) return c.json({ error: 'not found' }, 404)

    const body = (await c.req.json().catch(() => ({}))) as { force?: boolean }
    const force = body.force === true

    const cards = listCards(deps.db, user.id, deckId)
    if (pitchTargets(cards, { force }).length === 0)
      return c.json({ updated: 0, total: cards.length })

    const fetcher = await pitchFetcherFor(deps, user.id, deck.targetLang, {
      dictionaryOnly: force,
    })
    if (!fetcher) return c.json({ error: 'No OpenRouter key — add one in Settings.' }, 502)

    try {
      return c.json(await backfillDeckPitch(deps.db, user.id, deckId, fetcher, { force }))
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502)
    }
  })
}
