import { BACKSPACE, CLEAR, ENTER, SPACE, emptyState, type ImeEngine, type ImeState } from './types'

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'
const JONG = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'

const VOWEL_COMPOUND: Record<string, string> = {
  ㅗㅏ: 'ㅘ',
  ㅗㅐ: 'ㅙ',
  ㅗㅣ: 'ㅚ',
  ㅜㅓ: 'ㅝ',
  ㅜㅔ: 'ㅞ',
  ㅜㅣ: 'ㅟ',
  ㅡㅣ: 'ㅢ',
}

const JONG_COMPOUND: Record<string, string> = {
  ㄱㅅ: 'ㄳ',
  ㄴㅈ: 'ㄵ',
  ㄴㅎ: 'ㄶ',
  ㄹㄱ: 'ㄺ',
  ㄹㅁ: 'ㄻ',
  ㄹㅂ: 'ㄼ',
  ㄹㅅ: 'ㄽ',
  ㄹㅌ: 'ㄾ',
  ㄹㅍ: 'ㄿ',
  ㄹㅎ: 'ㅀ',
  ㅂㅅ: 'ㅄ',
}

const JONG_SPLIT: Record<string, [string, string]> = {
  ㄳ: ['ㄱ', 'ㅅ'],
  ㄵ: ['ㄴ', 'ㅈ'],
  ㄶ: ['ㄴ', 'ㅎ'],
  ㄺ: ['ㄹ', 'ㄱ'],
  ㄻ: ['ㄹ', 'ㅁ'],
  ㄼ: ['ㄹ', 'ㅂ'],
  ㄽ: ['ㄹ', 'ㅅ'],
  ㄾ: ['ㄹ', 'ㅌ'],
  ㄿ: ['ㄹ', 'ㅍ'],
  ㅀ: ['ㄹ', 'ㅎ'],
  ㅄ: ['ㅂ', 'ㅅ'],
}

const ROWS = [
  ['ㅂ', 'ㅈ', 'ㄷ', 'ㄱ', 'ㅅ', 'ㅛ', 'ㅕ', 'ㅑ', 'ㅐ', 'ㅔ'],
  ['ㅁ', 'ㄴ', 'ㅇ', 'ㄹ', 'ㅎ', 'ㅗ', 'ㅓ', 'ㅏ', 'ㅣ'],
  ['ㅋ', 'ㅌ', 'ㅊ', 'ㅍ', 'ㅠ', 'ㅜ', 'ㅡ'],
]

const SHIFT: Record<string, string> = {
  ㅂ: 'ㅃ',
  ㅈ: 'ㅉ',
  ㄷ: 'ㄸ',
  ㄱ: 'ㄲ',
  ㅅ: 'ㅆ',
  ㅐ: 'ㅒ',
  ㅔ: 'ㅖ',
}

const PHYSICAL: Record<string, string> = {
  q: 'ㅂ',
  w: 'ㅈ',
  e: 'ㄷ',
  r: 'ㄱ',
  t: 'ㅅ',
  y: 'ㅛ',
  u: 'ㅕ',
  i: 'ㅑ',
  o: 'ㅐ',
  p: 'ㅔ',
  a: 'ㅁ',
  s: 'ㄴ',
  d: 'ㅇ',
  f: 'ㄹ',
  g: 'ㅎ',
  h: 'ㅗ',
  j: 'ㅓ',
  k: 'ㅏ',
  l: 'ㅣ',
  z: 'ㅋ',
  x: 'ㅌ',
  c: 'ㅊ',
  v: 'ㅍ',
  b: 'ㅠ',
  n: 'ㅜ',
  m: 'ㅡ',
}

interface Syllable {
  cho: string
  jung: string
  jong: string
}

const EMPTY: Syllable = { cho: '', jung: '', jong: '' }

function isConsonant(ch: string): boolean {
  return CHO.includes(ch) || Object.values(JONG_COMPOUND).includes(ch)
}

function isVowel(ch: string): boolean {
  return JUNG.includes(ch)
}

function isSyllable(text: string): boolean {
  return text.length === 1 && text >= '\uac00' && text <= '\ud7a3'
}

function compose(cho: string, jung: string, jong: string): string {
  const ci = CHO.indexOf(cho)
  const vi = JUNG.indexOf(jung)
  if (ci < 0 || vi < 0) return cho + jung + jong
  const ji = jong ? JONG.indexOf(jong) : 0
  return String.fromCharCode(0xac00 + ci * 588 + vi * 28 + (ji < 0 ? 0 : ji))
}

function decompose(syllable: string): Syllable {
  const code = syllable.charCodeAt(0) - 0xac00
  return {
    cho: CHO[Math.floor(code / 588)] ?? '',
    jung: JUNG[Math.floor((code % 588) / 28)] ?? '',
    jong: JONG[code % 28] === ' ' ? '' : JONG[code % 28]!,
  }
}

function parse(preedit: string): Syllable {
  if (!preedit) return EMPTY
  if (isSyllable(preedit)) return decompose(preedit)
  const chars = [...preedit]
  const [a, b, c] = chars
  if (a && isConsonant(a)) return { cho: a, jung: b && isVowel(b) ? b : '', jong: c ?? '' }
  if (a && isVowel(a)) return { cho: '', jung: a, jong: '' }
  return EMPTY
}

function jamoList(preedit: string): string[] {
  if (!preedit) return []
  if (isSyllable(preedit)) {
    const { cho, jung, jong } = decompose(preedit)
    return [cho, jung, ...(jong ? [jong] : [])]
  }
  return [...preedit]
}

function composeJamo(jamo: string[]): string {
  if (jamo.length === 0) return ''
  const first = jamo[0]!
  if (isVowel(first)) return compose('ㅇ', first, '')
  if (jamo.length === 1) return first
  const jung = jamo[1]!
  if (!isVowel(jung)) return jamo.join('')
  return compose(first, jung, jamo[2] ?? '')
}

function keep(state: ImeState, preedit: string): ImeState {
  return { ...state, preedit, buffer: '', candidates: [] }
}

function start(state: ImeState, preedit: string): ImeState {
  return { ...state, value: state.value + state.preedit, preedit, buffer: '', candidates: [] }
}

function advance(state: ImeState, committed: string, preedit: string): ImeState {
  return { ...state, value: state.value + committed, preedit, buffer: '', candidates: [] }
}

function consonant(state: ImeState, ch: string): ImeState {
  const { cho, jung, jong } = parse(state.preedit)
  if (!cho) return keep(state, ch)
  if (!jung) return start(state, ch)
  if (!jong) return JONG.includes(ch) ? keep(state, compose(cho, jung, ch)) : start(state, ch)
  const compound = JONG_COMPOUND[jong + ch]
  return compound ? keep(state, compose(cho, jung, compound)) : start(state, ch)
}

function vowel(state: ImeState, ch: string): ImeState {
  const { cho, jung, jong } = parse(state.preedit)
  if (!cho) return keep(state, compose('ㅇ', ch, ''))
  if (!jung) return keep(state, compose(cho, ch, ''))
  if (jong) {
    const split = JONG_SPLIT[jong]
    const kept = split ? compose(cho, jung, split[0]) : compose(cho, jung, '')
    return advance(state, kept, compose(split ? split[1] : jong, ch, ''))
  }
  const compound = VOWEL_COMPOUND[jung + ch]
  return compound ? keep(state, compose(cho, compound, '')) : start(state, compose('ㅇ', ch, ''))
}

function back(state: ImeState): ImeState {
  const jamo = jamoList(state.preedit)
  if (jamo.length) {
    jamo.pop()
    return keep(state, composeJamo(jamo))
  }
  if (!state.value) return state
  const last = state.value.slice(-1)
  const jamo2 = jamoList(last)
  jamo2.pop()
  return { ...state, value: state.value.slice(0, -1), preedit: composeJamo(jamo2) }
}

function press(state: ImeState, key: string): ImeState {
  if (key === BACKSPACE) return back(state)
  if (key === CLEAR) return keep(state, '')
  if (key === SPACE) return { ...state, value: state.value + state.preedit + ' ', preedit: '' }
  if (key === ENTER) return { ...state, value: state.value + state.preedit, preedit: '' }
  if (isConsonant(key)) return consonant(state, key)
  if (isVowel(key)) return vowel(state, key)
  return state
}

export const hangul: ImeEngine = {
  id: 'hangul',
  language: 'ko',
  label: '한글',
  columns: 10,
  rows: ROWS,
  shift: SHIFT,
  physical: PHYSICAL,
  initial: emptyState,
  press,
  finish: (state) => state.value + state.preedit,
}
