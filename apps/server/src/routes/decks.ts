import { addCard, createDeck, getDeck, getRoles, listCards, listDecks } from '../db/repo'
import { roleReasoning } from '../env'
import { OpenRouter } from '../llm/openrouter'
import { MANDARIN_RULE } from '../llm/prompts'
import { resolveUserKey } from '../llm/userkey'
import { readingsFor, seedStarterDecks } from '../seed/service'
import type { App } from '../context'

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

export function registerDecks(app: App) {
  app.get('/api/decks', (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    seedStarterDecks(deps.db, user.id) // every user gets the frequency decks
    return c.json({ decks: listDecks(deps.db, user.id) })
  })

  app.get('/api/decks/:id/cards', (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const deck = getDeck(deps.db, c.req.param('id'), user.id)
    if (!deck) return c.json({ error: 'not found' }, 404)
    return c.json({ deck, cards: listCards(deps.db, user.id, deck.id) })
  })

  // Create a deck. With a `topic`, the LLM (generator role) writes the cards.
  app.post('/api/decks', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string
      targetLang?: string
      level?: string
      topic?: string
      count?: number
    }
    const targetLang = body.targetLang ?? user.targetLang ?? 'zh'
    const sourceLang = user.nativeLang ?? 'en'

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
}
