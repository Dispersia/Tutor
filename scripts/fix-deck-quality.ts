import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Deps } from '../apps/server/src/context'

process.env.TUTOR_DATA_DIR ||= join(homedir(), '.local/share/tutor')

const { env } = await import('../apps/server/src/env')
const { openDb } = await import('../apps/server/src/db/client')
const { getRoles, listCards, listDecks, listUsers, updateCard } =
  await import('../apps/server/src/db/repo')
const { META_MARKERS, stripMetaCommentary } = await import('../apps/server/src/deck/plan')
const { mandarinSentenceZhuyin } = await import('../apps/server/src/deck/mandarin')
const { zhuyinFromPinyin } = await import('../apps/server/src/deck/context')
const { resolveUserKey } = await import('../apps/server/src/llm/userkey')
const { OpenRouter } = await import('../apps/server/src/llm/openrouter')

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const useLlm = args.includes('--llm')
const needle = args.find((a) => !a.startsWith('--'))?.toLowerCase()
const limit = Number(args.find((a) => a.startsWith('--limit='))?.slice(8) ?? 0)

const { db, sqlite } = openDb(join(env.dataDir, 'tutor.db'))
const keyDeps = { db, secret: env.secret, serverKey: env.openrouterKey } as unknown as Deps

const TEXT_FIELDS = ['gloss', 'prompt', 'rule', 'explanation'] as const

const looksPinyin = (s: string | undefined): boolean => Boolean(s && /[a-zA-Z]/.test(s))

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

function repairReadings(
  card: ReturnType<typeof listCards>[number],
): Record<string, string> | undefined {
  if (card.targetLang === 'zh' && looksPinyin(card.readings.zhuyin)) {
    const zhuyin = zhuyinFromPinyin(card.readings.zhuyin!) ?? mandarinSentenceZhuyin(card.back)
    return zhuyin ? { ...card.readings, zhuyin } : undefined
  }
  if (card.targetLang === 'zh' && !card.readings.zhuyin && !card.readings.pinyin) {
    const zhuyin = mandarinSentenceZhuyin(card.back)
    if (zhuyin) return { ...card.readings, zhuyin }
  }
  return undefined
}

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

const SYSTEM = `You translate sentences into English for language-learning cards. Return only the JSON the schema asks for, with one entry per id.

For each sentence, write the one natural English sentence a native speaker would use for the same meaning. Translate the meaning, not the words in order: 我想你。 is "I miss you.", not "I think you."; 本があります。 is "There is a book.", not "Book exists."

Each translation is a single plain sentence and nothing else: no notes, quotes, alternatives, romanization or bracketed labels.`

async function translateBatch(
  or: InstanceType<typeof OpenRouter>,
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

for (const user of listUsers(db)) {
  for (const deck of listDecks(db)) {
    if (needle && deck.id !== needle && !deck.name.toLowerCase().includes(needle)) continue
    const cards = listCards(db, user.id, deck.id)
    console.log(`[fix] ${deck.name} (${cards.length} cards)`)

    for (const card of cards) {
      const patch = repairCardText(card)
      if (Object.keys(patch).length === 0) continue
      if (patch.readings) repairedReadings++
      if (patch.front || patch.payload) repairedText++
      if (!dry) updateCard(db, card.id, patch)
    }

    if (useLlm) {
      const key = await resolveUserKey(keyDeps, user.id)
      if (!key) {
        console.warn(`[fix] no OpenRouter key for ${user.username}; skipping the translation pass`)
        continue
      }
      const model = getRoles(db, user.id, env.defaultRoles).translator
      const or = new OpenRouter(key)
      const live = dry ? cards : listCards(db, user.id, deck.id)
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
          updateCard(db, card.id, {
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
sqlite.close()
