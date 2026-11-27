import { env } from '../apps/server/src/env'
import { openDb } from '../apps/server/src/db/client'
import { listCards, updateCard, type ServerCard } from '../apps/server/src/db/repo'
import { loadLexicon } from '../apps/server/src/deck/lexicon'
import { kanaFromWords } from '../apps/server/src/text/readings'
import type { CardId } from '../apps/server/src/ids'

const dry = process.argv.includes('--dry')

const { db } = openDb(`${env.dataDir.replace(/\/+$/, '')}/tutor.db`)
const lexicon = loadLexicon('ja')
if (!lexicon) throw new Error('no Japanese lexicon')

const readingOf = (word: string) => lexicon.get(word)?.reading

function cardWords(card: ServerCard): string[] | undefined {
  if (card.type === 'phrase') {
    const tokens = Array.isArray(card.payload?.tokens)
      ? card.payload.tokens.filter((t): t is string => typeof t === 'string' && t.length > 0)
      : []
    return tokens.length > 0 ? tokens : undefined
  }
  return card.type === 'vocab' ? [card.back] : undefined
}

let changed = 0
let left = 0
for (const card of listCards(db)) {
  if (card.targetLang !== 'ja') continue
  const words = cardWords(card)
  if (!words) continue
  const reading = kanaFromWords(words, readingOf)
  if (!reading) {
    left++
    continue
  }
  if (reading === card.readings.kana) continue
  changed++
  console.log(`${dry ? '[dry] ' : ''}${card.back}\t${card.readings.kana ?? ''} -> ${reading}`)
  if (!dry) updateCard(db, card.id as CardId, { readings: { ...card.readings, kana: reading } })
}

console.log(
  `${dry ? '[dry] ' : ''}updated ${changed} cards (${left} left without a dictionary reading)`,
)
