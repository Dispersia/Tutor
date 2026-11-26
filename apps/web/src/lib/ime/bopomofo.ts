import { BACKSPACE, CLEAR, ENTER, SPACE, emptyState, type ImeEngine, type ImeState } from './types'

const SYMBOLS = 'ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄧㄨㄩㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦ'

const TONES = 'ˊˇˋ˙'

const ROWS = [
  ['ㄅ', 'ㄉ', 'ˇ', 'ˋ', 'ㄓ', 'ˊ', '˙', 'ㄚ', 'ㄞ', 'ㄢ', 'ㄦ'],
  ['ㄆ', 'ㄊ', 'ㄍ', 'ㄐ', 'ㄔ', 'ㄗ', 'ㄧ', 'ㄛ', 'ㄟ', 'ㄣ'],
  ['ㄇ', 'ㄋ', 'ㄎ', 'ㄑ', 'ㄕ', 'ㄘ', 'ㄨ', 'ㄜ', 'ㄠ', 'ㄤ'],
  ['ㄈ', 'ㄌ', 'ㄏ', 'ㄒ', 'ㄖ', 'ㄙ', 'ㄩ', 'ㄝ', 'ㄡ', 'ㄥ'],
]

const PHYSICAL: Record<string, string> = {
  '1': 'ㄅ',
  '2': 'ㄉ',
  '3': 'ˇ',
  '4': 'ˋ',
  '5': 'ㄓ',
  '6': 'ˊ',
  '7': '˙',
  '8': 'ㄚ',
  '9': 'ㄞ',
  '0': 'ㄢ',
  '-': 'ㄦ',
  q: 'ㄆ',
  w: 'ㄊ',
  e: 'ㄍ',
  r: 'ㄐ',
  t: 'ㄔ',
  y: 'ㄗ',
  u: 'ㄧ',
  i: 'ㄛ',
  o: 'ㄟ',
  p: 'ㄣ',
  a: 'ㄇ',
  s: 'ㄋ',
  d: 'ㄎ',
  f: 'ㄑ',
  g: 'ㄕ',
  h: 'ㄘ',
  j: 'ㄨ',
  k: 'ㄜ',
  l: 'ㄠ',
  ';': 'ㄤ',
  z: 'ㄈ',
  x: 'ㄌ',
  c: 'ㄏ',
  v: 'ㄒ',
  b: 'ㄖ',
  n: 'ㄙ',
  m: 'ㄩ',
  ',': 'ㄝ',
  '.': 'ㄡ',
  '/': 'ㄥ',
}

function symbol(state: ImeState, ch: string): ImeState {
  return { ...state, preedit: state.preedit + ch, candidates: [] }
}

function tone(state: ImeState, mark: string): ImeState {
  if (!state.preedit) return state
  return { ...state, preedit: state.preedit + mark, candidates: [] }
}

function back(state: ImeState): ImeState {
  if (!state.preedit) {
    return state.value ? { ...state, value: state.value.slice(0, -1) } : state
  }
  return { ...state, preedit: state.preedit.slice(0, -1), candidates: [] }
}

function top(state: ImeState): string {
  return state.candidates[0] ?? state.preedit.trimEnd()
}

function commit(state: ImeState): ImeState {
  return { ...state, value: state.value + top(state), preedit: '', candidates: [] }
}

function press(state: ImeState, key: string): ImeState {
  if (key === BACKSPACE) return back(state)
  if (key === CLEAR) return { ...state, preedit: '', candidates: [] }
  if (key === ENTER || key === SPACE) return commit(state)
  if (TONES.includes(key)) return tone(state, key)
  if (SYMBOLS.includes(key)) return symbol(state, key)
  return state
}

export const bopomofo: ImeEngine = {
  id: 'bopomofo',
  language: 'zh',
  label: '注音',
  columns: 11,
  rows: ROWS,
  physical: PHYSICAL,
  initial: emptyState,
  press,
  finish: (state) => state.value + top(state),
}
