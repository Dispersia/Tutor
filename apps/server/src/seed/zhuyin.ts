/**
 * Pinyin → Zhuyin (bopomofo) conversion (docs/DESIGN.md §13.7).
 *
 * Chinese cards store pinyin; the UI shows Zhuyin next to the characters. The
 * mapping is mechanical, so we derive it instead of hand-writing ~200 readings.
 *
 * Tones: 1 = (no mark), 2 = ˊ, 3 = ˇ, 4 = ˋ, neutral = ˙ (written before the
 * syllable, as is conventional in Zhuyin).
 */

const INITIALS_TWO: Record<string, string> = { zh: 'ㄓ', ch: 'ㄔ', sh: 'ㄕ' }
const INITIALS_ONE: Record<string, string> = {
  b: 'ㄅ',
  p: 'ㄆ',
  m: 'ㄇ',
  f: 'ㄈ',
  d: 'ㄉ',
  t: 'ㄊ',
  n: 'ㄋ',
  l: 'ㄌ',
  g: 'ㄍ',
  k: 'ㄎ',
  h: 'ㄏ',
  j: 'ㄐ',
  q: 'ㄑ',
  x: 'ㄒ',
  r: 'ㄖ',
  z: 'ㄗ',
  c: 'ㄘ',
  s: 'ㄙ',
}

/** Finals keyed by their written-ascii form (v stands for ü). */
const FINALS: Record<string, string> = {
  a: 'ㄚ',
  o: 'ㄛ',
  e: 'ㄜ',
  er: 'ㄦ',
  ai: 'ㄞ',
  ei: 'ㄟ',
  ao: 'ㄠ',
  ou: 'ㄡ',
  an: 'ㄢ',
  en: 'ㄣ',
  ang: 'ㄤ',
  eng: 'ㄥ',
  i: 'ㄧ',
  ia: 'ㄧㄚ',
  ie: 'ㄧㄝ',
  iao: 'ㄧㄠ',
  iu: 'ㄧㄡ',
  ian: 'ㄧㄢ',
  in: 'ㄧㄣ',
  iang: 'ㄧㄤ',
  ing: 'ㄧㄥ',
  iong: 'ㄩㄥ',
  io: 'ㄧㄛ',
  u: 'ㄨ',
  ua: 'ㄨㄚ',
  uo: 'ㄨㄛ',
  uai: 'ㄨㄞ',
  ui: 'ㄨㄟ',
  uan: 'ㄨㄢ',
  un: 'ㄨㄣ',
  uang: 'ㄨㄤ',
  ong: 'ㄨㄥ',
  ueng: 'ㄨㄥ',
  v: 'ㄩ',
  ve: 'ㄩㄝ',
  van: 'ㄩㄢ',
  vn: 'ㄩㄣ',
  ue: 'ㄩㄝ',
}

/** Longest finals first, so greedy matching picks ian over i + an. */
const FINAL_KEYS = Object.keys(FINALS).sort((a, b) => b.length - a.length)

/** y-/w- spellings map to a "true" final (no consonant is written). */
const Y_FINAL: Record<string, string> = {
  i: 'i',
  a: 'ia',
  e: 'ie',
  ao: 'iao',
  ou: 'iu',
  an: 'ian',
  in: 'in',
  ang: 'iang',
  ing: 'ing',
  ong: 'iong',
  o: 'io',
  u: 'v',
  ue: 've',
  uan: 'van',
  un: 'vn',
}
const W_FINAL: Record<string, string> = {
  u: 'u',
  a: 'ua',
  o: 'uo',
  ai: 'uai',
  ei: 'ui',
  an: 'uan',
  en: 'un',
  ang: 'uang',
  eng: 'ueng',
}

const TONE_MARKS: Record<string, [string, number]> = {
  ā: ['a', 1],
  á: ['a', 2],
  ǎ: ['a', 3],
  à: ['a', 4],
  ē: ['e', 1],
  é: ['e', 2],
  ě: ['e', 3],
  è: ['e', 4],
  ī: ['i', 1],
  í: ['i', 2],
  ǐ: ['i', 3],
  ì: ['i', 4],
  ō: ['o', 1],
  ó: ['o', 2],
  ǒ: ['o', 3],
  ò: ['o', 4],
  ū: ['u', 1],
  ú: ['u', 2],
  ǔ: ['u', 3],
  ù: ['u', 4],
  ǖ: ['v', 1],
  ǘ: ['v', 2],
  ǚ: ['v', 3],
  ǜ: ['v', 4],
  ü: ['v', 0],
}

const isVowel = (c: string) => 'aeiouv'.includes(c)

/** Decomposes a pinyin syllable into ascii letters + the tone of each letter. */
function decompose(raw: string): { letters: string; tones: number[] } {
  let letters = ''
  const tones: number[] = []
  for (const ch of raw) {
    const marked = TONE_MARKS[ch]
    if (marked) {
      letters += marked[0]
      tones.push(marked[1])
    } else {
      const lower = ch.toLowerCase()
      letters += lower === 'ü' ? 'v' : lower
      tones.push(0)
    }
  }
  return { letters, tones }
}

/** One syllable: initial + true final → bopomofo + tone mark. */
function convertSyllable(letters: string, tones: number[]): string {
  const tone = tones.find((t) => t > 0) ?? 0
  let rest = letters
  let initial = ''

  if (rest.startsWith('y')) {
    const mapped = Y_FINAL[rest.slice(1)]
    if (mapped) {
      return finish('', mapped, tone)
    }
  }
  if (rest.startsWith('w')) {
    const mapped = W_FINAL[rest.slice(1)]
    if (mapped) {
      return finish('', mapped, tone)
    }
  }

  const two = rest.slice(0, 2)
  if (INITIALS_TWO[two]) {
    initial = INITIALS_TWO[two]!
    rest = rest.slice(2)
  } else if (INITIALS_ONE[rest[0]!]) {
    initial = INITIALS_ONE[rest[0]!]!
    rest = rest.slice(1)
  }

  // j/q/x write ü as u: ju → jü, jue → jüe, juan → jüan, jun → jün
  if (initial && 'ㄐㄑㄒ'.includes(initial) && rest.startsWith('u')) {
    rest = `v${rest.slice(1)}`
  }
  // zhi/chi/shi/ri/zi/ci/si: the "i" is not written in Zhuyin
  if (initial && 'ㄓㄔㄕㄖㄗㄘㄙ'.includes(initial) && rest === 'i') {
    rest = ''
  }
  return finish(initial, rest, tone)
}

function finish(initial: string, final: string, tone: number): string {
  const body = initial + (final ? (FINALS[final] ?? `?${final}`) : '')
  if (tone === 2) return body + 'ˊ'
  if (tone === 3) return body + 'ˇ'
  if (tone === 4) return body + 'ˋ'
  if (tone === 0) return body === 'ㄦ' ? body : '˙' + body // neutral tone (儿 stays bare)
  return body // first tone has no mark
}

/** Splits a run of letters (no tone diacritics) into pinyin syllables. */
function segment(letters: string, tones: number[]): string[] {
  const out: string[] = []
  let i = 0
  while (i < letters.length) {
    // a stray "r" is the erhua suffix (哪儿 = na + r)
    if (letters[i] === 'r' && (i + 1 >= letters.length || !isVowel(letters[i + 1]!))) {
      out.push('er')
      i += 1
      continue
    }
    const start = i
    const two = letters.slice(i, i + 2)
    if (INITIALS_TWO[two]) i += 2
    else if (INITIALS_ONE[letters[i]!]) i += 1
    else if (letters[i] === 'y' || letters[i] === 'w') i += 1
    // match the longest final
    const final = FINAL_KEYS.find((f) => letters.startsWith(f, i))
    if (final) i += final.length
    else if (i === start) i += 1 // unknown char: consume one to avoid a loop
    out.push(letters.slice(start, i))
  }
  // attach tones: each syllable owns the first tone > 0 inside its span
  let pos = 0
  return out.map((syl) => {
    const span = tones.slice(pos, pos + syl.length)
    pos += syl.length
    const t = span.find((t) => t > 0) ?? 0
    return convertSyllable(syl, [t])
  })
}

/** Converts a pinyin string ("nǐ hǎo", "Zhōngguó", "nǚ'ér") to Zhuyin. */
export function pinyinToZhuyin(pinyin: string): string {
  if (!pinyin.trim()) return ''
  const syllables = pinyin.replace(/['’]/g, ' ').split(/\s+/).filter(Boolean)
  return syllables
    .flatMap((word) => {
      const { letters, tones } = decompose(word)
      return segment(letters, tones)
    })
    .join(' ')
}
