/**
 * One-off deck repair for LLM generation defects (docs/DESIGN.md §11):
 *
 *  1. Pinyin stored where Zhuyin belongs (readings_json.zhuyin with Latin
 *     letters) — converted with the same pinyin→Zhuyin rule the seed uses.
 *  2. A leading "Translate:" (the model echoing its instruction) and leaked
 *     reasoning in front / gloss / rule / explanation — stripped or dropped.
 *  3. Word-by-word English on sentence cards ("I think you." for 我想你。) — with
 *     `--llm`, re-translated into one natural sentence by the translator role.
 *
 * The card id is kept, so SRS scheduling and review history survive.
 *
 *   TUTOR_DATA_DIR=~/.local/share/tutor \
 *     bun scripts/fix-deck-quality.ts <deck-id-or-name> [--llm] [--dry]
 *
 * Read this as a maintenance tool, not part of the request path.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

process.env.TUTOR_DATA_DIR ||= join(homedir(), '.local/share/tutor')

const { env } = await import('../apps/server/src/env')
const { buildDeps } = await import('../apps/server/src/bootstrap')
const { getRoles, listCards, listDecks, listUsers, updateCard } =
  await import('../apps/server/src/db/repo')
const { META_MARKERS, stripMetaCommentary } = await import('../apps/server/src/deck/plan')
const { mandarinSentenceZhuyin } = await import('../apps/server/src/deck/mandarin')
const { pinyinToZhuyin } = await import('../apps/server/src/seed/zhuyin')
const { resolveUserKey } = await import('../apps/server/src/llm/userkey')
const { OpenRouter } = await import('../apps/server/src/llm/openrouter')

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const useLlm = args.includes('--llm')
const needle = args.find((a) => !a.startsWith('--'))?.toLowerCase()
const limit = Number(args.find((a) => a.startsWith('--limit='))?.slice(8) ?? 0)

const { deps, close } = buildDeps(env)

/** Fields that are shown to the learner and must never hold model reasoning. */
const TEXT_FIELDS = ['gloss', 'prompt', 'rule', 'explanation'] as const

/** True when a Chinese reading is actually pinyin (Latin letters). */
const looksPinyin = (s: string | undefined): boolean => Boolean(s && /[a-zA-Z]/.test(s))

/** The card's sentence/grammar English that reads like a word-by-word gloss. */
function looksLiteral(english: string): boolean {
  return /-(?:[a-z]{2,})|\b(?:classifier|particle|how-many|to-sleep)\b/i.test(english)
}

interface RepairPatch {
  front?: string
  readings?: Record<string, string>
  payload?: Record<string, unknown>
}

function repairCardText(card: ReturnType<typeof listCards>[number]): RepairPatch {
  const patch: RepairPatch = {}
  const readings = repairReadings(card)
  if (readings) patch.readings = readings
  const front = stripMetaCommentary(card.front)
  if (front !== card.front) patch.front = front
  const payload = cleanTextFields(card.payload ?? {})
  if (payload) patch.payload = payload
  return patch
}

/** Fixes a pinyin-as-Zhuyin reading, or fills a missing one. */
function repairReadings(
  card: ReturnType<typeof listCards>[number],
): Record<string, string> | undefined {
  if (looksPinyin(card.readings.zhuyin)) {
    return { ...card.readings, zhuyin: pinyinToZhuyin(card.readings.zhuyin!) }
  }
  if (card.targetLang === 'zh' && !card.readings.zhuyin && !card.readings.pinyin) {
    // Fill a missing Zhuyin reading from the Taiwan dictionary.
    const zhuyin = mandarinSentenceZhuyin(card.back)
    if (zhuyin) return { ...card.readings, zhuyin }
  }
  return undefined
}

/** Strips meta commentary from the payload text fields, or undefined when clean. */
function cleanTextFields(current: Record<string, unknown>): Record<string, unknown> | undefined {
  const payload = { ...current }
  let changed = false
  for (const key of TEXT_FIELDS) {
    const v = payload[key]
    if (typeof v !== 'string') continue
    const cleaned = stripMetaCommentary(v)
    if (!cleaned || cleaned.length > 200 || META_MARKERS.test(cleaned)) {
      delete payload[key]
      changed = true
    } else if (cleaned !== v) {
      payload[key] = cleaned
      changed = true
    }
  }
  return changed ? payload : undefined
}

/** Sentence cards whose English needs a real translation pass. */
function needsEnglish(card: ReturnType<typeof listCards>[number]): boolean {
  if (card.payload?.template !== 'sentence') return false
  const gloss = typeof card.payload.gloss === 'string' ? card.payload.gloss : ''
  return card.front !== gloss || looksLiteral(card.front) || looksLiteral(gloss)
}

const TRANSLATION_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, english: { type: 'string' } },
        required: ['id', 'english'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const

const SYSTEM = `You translate single sentences into English for a language-learning card. For each item, translate what the WHOLE sentence MEANS, naturally and idiomatically — never word by word. A Chinese "我想你。" is "I miss you." (never "I think you."); a Japanese "請坐。" style literal gloss like "Book exists here" is "The book is here.". Return one plain English sentence per item: no notes, no quotes, no "Translate:", no romanization/pinyin, no alternative separated by "/", no "(polite)" or "(classifier)". Keep it short.`

async function translateBatch(
  or: OpenRouter,
  model: string,
  lang: string,
  cards: ReturnType<typeof listCards>,
): Promise<Map<string, string>> {
  const list = cards.map((c) => `- id=${c.id} text=${c.back}`).join('\n')
  const { json } = await or.chatJSON<{ items: { id: string; english: string }[] }>({
    model,
    schema: TRANSLATION_SCHEMA,
    schemaName: 'translations',
    reasoning: 'none',
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Target language: ${lang}. Translate each sentence:\n${list}` },
    ],
  })
  return new Map((json.items ?? []).map((i) => [i.id, i.english.trim()]))
}

let repairedReadings = 0
let repairedText = 0
let retranslated = 0

for (const user of listUsers(deps.db)) {
  for (const deck of listDecks(deps.db, user.id)) {
    if (needle && deck.id !== needle && !deck.name.toLowerCase().includes(needle)) continue
    const cards = listCards(deps.db, user.id, deck.id)
    console.log(`[fix] ${deck.name} (${cards.length} cards)`)

    // Pass 1 + 2: deterministic repairs.
    for (const card of cards) {
      const patch = repairCardText(card)
      if (Object.keys(patch).length === 0) continue
      if (patch.readings) repairedReadings++
      if (patch.front || patch.payload) repairedText++
      if (!dry) updateCard(deps.db, card.id, user.id, patch)
    }

    // Pass 3: word-by-word English -> one natural sentence.
    if (useLlm) {
      const key = await resolveUserKey(deps, user.id)
      if (!key) {
        console.warn(`[fix] no OpenRouter key for ${user.username}; skipping the translation pass`)
        continue
      }
      const model = getRoles(deps.db, user.id, deps.defaults).translator
      const or = new OpenRouter(key, deps.or.baseUrl)
      // Re-read after the text pass, so a leaked rule/explanation we just
      // dropped is not resurrected by the gloss update below.
      const live = dry ? cards : listCards(deps.db, user.id, deck.id)
      const all = live.filter(needsEnglish)
      const targets = limit > 0 ? all.slice(0, limit) : all
      console.log(`[fix] ${all.length} sentence cards need a natural translation`)
      for (let i = 0; i < targets.length; i += 30) {
        const batch = targets.slice(i, i + 30)
        const map = await translateBatch(or, model, deck.targetLang, batch)
        for (const card of batch) {
          const english = map.get(card.id)
          if (!english) continue
          retranslated++
          if (dry) {
            console.log(`[fix]   ${card.back}  ${card.front}  ->  ${english}`)
            continue
          }
          updateCard(deps.db, card.id, user.id, {
            front: english,
            payload: { ...(card.payload ?? {}), gloss: english },
          })
        }
        console.log(`[fix] translated ${Math.min(i + 30, targets.length)}/${targets.length}`)
      }
    }
  }
}

console.log(
  `[fix] ${dry ? 'would repair' : 'repaired'}: ${repairedReadings} readings, ${repairedText} text fields, ${retranslated} sentence translations`,
)
close()
