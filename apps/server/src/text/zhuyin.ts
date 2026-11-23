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

const FINAL_KEYS = Object.keys(FINALS).sort((a, b) => b.length - a.length)

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

function convertSyllable(letters: string, tones: number[]): string {
  const tone = tones.find((t) => t > 0) ?? 0
  const yw = ywFinal(letters)
  if (yw) return finish('', yw, tone)
  const { initial, rest } = splitInitial(letters)
  return finish(initial, fixFinal(initial, rest), tone)
}

function ywFinal(letters: string): string | undefined {
  if (letters.startsWith('y')) return Y_FINAL[letters.slice(1)]
  if (letters.startsWith('w')) return W_FINAL[letters.slice(1)]
  return undefined
}

function splitInitial(letters: string): { initial: string; rest: string } {
  const two = letters.slice(0, 2)
  if (INITIALS_TWO[two]) return { initial: INITIALS_TWO[two]!, rest: letters.slice(2) }
  const one = letters[0] ? INITIALS_ONE[letters[0]] : undefined
  return one ? { initial: one, rest: letters.slice(1) } : { initial: '', rest: letters }
}

function fixFinal(initial: string, rest: string): string {
  if (initial && 'ㄐㄑㄒ'.includes(initial) && rest.startsWith('u')) return `v${rest.slice(1)}`
  if (initial && 'ㄓㄔㄕㄖㄗㄘㄙ'.includes(initial) && rest === 'i') return ''
  return rest
}

function finish(initial: string, final: string, tone: number): string {
  const body = initial + (final ? (FINALS[final] ?? `?${final}`) : '')
  if (tone === 2) return body + 'ˊ'
  if (tone === 3) return body + 'ˇ'
  if (tone === 4) return body + 'ˋ'
  if (tone === 0) return body === 'ㄦ' ? body : '˙' + body
  return body
}

function segment(letters: string, tones: number[]): string[] {
  const out: string[] = []
  let i = 0
  while (i < letters.length) {
    if (isErhua(letters, i)) {
      out.push('er')
      i += 1
      continue
    }
    const { syl, next } = syllableAt(letters, i)
    out.push(syl)
    i = next
  }
  return applyTones(out, tones)
}

function isErhua(letters: string, i: number): boolean {
  return letters[i] === 'r' && (i + 1 >= letters.length || !isVowel(letters[i + 1]!))
}

function syllableAt(letters: string, i: number): { syl: string; next: number } {
  const start = i
  const two = letters.slice(i, i + 2)
  if (INITIALS_TWO[two]) i += 2
  else if (INITIALS_ONE[letters[i]!]) i += 1
  else if (letters[i] === 'y' || letters[i] === 'w') i += 1
  const final = FINAL_KEYS.find((f) => letters.startsWith(f, i))
  if (final) i += final.length
  else if (i === start) i += 1
  return { syl: letters.slice(start, i), next: i }
}

function applyTones(syllables: string[], tones: number[]): string[] {
  let pos = 0
  return syllables.map((syl) => {
    const span = tones.slice(pos, pos + syl.length)
    pos += syl.length
    return convertSyllable(syl, [span.find((t) => t > 0) ?? 0])
  })
}

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
