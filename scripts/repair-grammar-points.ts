import { homedir } from 'node:os'
import { join } from 'node:path'

process.env.TUTOR_DATA_DIR ||= join(homedir(), '.local/share/tutor')

const { env } = await import('../apps/server/src/env')
const { openDb } = await import('../apps/server/src/db/client')
const { deleteCards, listCards, listDecks, updateCard } = await import('../apps/server/src/db/repo')

const dry = process.argv.slice(2).includes('--dry')

const { db, sqlite } = openDb(join(env.dataDir, 'tutor.db'))

interface SeedPoint {
  front: string
  rule: string
  prompt: string
  options: string[]
  explanation: string
}

const SEED_POINTS: Record<string, SeedPoint> = {
  'ja:は': {
    front: 'Topic particle: は',
    rule: 'topic particle',
    prompt: '私___人です。',
    options: ['は', 'が'],
    explanation:
      'は marks the topic, the thing the sentence is about, and it is written は but said わ. 私は人です means "as for me, I am a person", a plain statement about you, while 私が人です points at you as the answer ("I am the one who is a person"). The common mistake is using が for every subject, or forgetting that は is read わ here.',
  },
  'ja:か': {
    front: 'Question particle: か',
    rule: 'question particle',
    prompt: 'あなたは人です___。',
    options: ['か', 'は'],
    explanation:
      'か goes at the very end of a sentence to turn it into a question: あなたは人です is "you are a person", あなたは人ですか is "are you a person?". It comes after です, so the sentence keeps its normal word order, and it is not the topic marker は.',
  },
}

function pointCard(cards: ReturnType<typeof listCards>, back: string) {
  return cards.find(
    (c) =>
      c.type === 'grammar' &&
      c.back === back &&
      c.front.includes(back) &&
      typeof c.payload?.explanation === 'string',
  )
}

function seedPayload(seed: SeedPoint, back: string): Record<string, unknown> {
  return {
    template: 'grammar',
    prompt: seed.prompt,
    answer: back,
    options: seed.options,
    rule: seed.rule,
    explanation: seed.explanation,
    intro: true,
  }
}

let merged = 0
for (const deck of listDecks(db)) {
  if (deck.settings?.kind !== 'path') continue
  const cards = listCards(db, undefined, deck.id)
  for (const c of cards) {
    if (c.type !== 'vocab') continue
    const point = pointCard(cards, c.back)
    const seed = SEED_POINTS[`${deck.targetLang}:${c.back}`]
    if (!point && !seed) continue
    const step = c.payload?.step
    const payload = {
      ...c.payload,
      ...(point ? point.payload : seedPayload(seed!, c.back)),
      ...(typeof step === 'number' ? { step } : {}),
    }
    const front = point ? point.front : seed!.front
    console.log(`[repair] ${deck.name}: ${c.back} "${c.front}" -> "${front}" (step ${step})`)
    if (!dry) {
      updateCard(db, c.id, { type: 'grammar', front, payload })
      if (point) deleteCards(db, [point.id])
    }
    merged++
  }
}

console.log(`[repair] ${dry ? 'would merge' : 'merged'} ${merged} grammar points`)
sqlite.close()
