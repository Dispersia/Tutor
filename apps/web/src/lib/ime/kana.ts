import { BACKSPACE, CLEAR, ENTER, SPACE, emptyState, type ImeEngine, type ImeState } from './types'

const ROMAJI: Record<string, string> = {
  a: 'あ',
  i: 'い',
  u: 'う',
  e: 'え',
  o: 'お',
  ka: 'か',
  ki: 'き',
  ku: 'く',
  ke: 'け',
  ko: 'こ',
  sa: 'さ',
  si: 'し',
  shi: 'し',
  su: 'す',
  se: 'せ',
  so: 'そ',
  ta: 'た',
  ti: 'ち',
  chi: 'ち',
  tu: 'つ',
  tsu: 'つ',
  te: 'て',
  to: 'と',
  na: 'な',
  ni: 'に',
  nu: 'ぬ',
  ne: 'ね',
  no: 'の',
  ha: 'は',
  hi: 'ひ',
  hu: 'ふ',
  fu: 'ふ',
  he: 'へ',
  ho: 'ほ',
  ma: 'ま',
  mi: 'み',
  mu: 'む',
  me: 'め',
  mo: 'も',
  ya: 'や',
  yu: 'ゆ',
  yo: 'よ',
  ra: 'ら',
  ri: 'り',
  ru: 'る',
  re: 'れ',
  ro: 'ろ',
  wa: 'わ',
  wo: 'を',
  ga: 'が',
  gi: 'ぎ',
  gu: 'ぐ',
  ge: 'げ',
  go: 'ご',
  za: 'ざ',
  zi: 'じ',
  ji: 'じ',
  zu: 'ず',
  ze: 'ぜ',
  zo: 'ぞ',
  da: 'だ',
  di: 'ぢ',
  du: 'づ',
  de: 'で',
  do: 'ど',
  ba: 'ば',
  bi: 'び',
  bu: 'ぶ',
  be: 'べ',
  bo: 'ぼ',
  pa: 'ぱ',
  pi: 'ぴ',
  pu: 'ぷ',
  pe: 'ぺ',
  po: 'ぽ',
  kya: 'きゃ',
  kyu: 'きゅ',
  kyo: 'きょ',
  sya: 'しゃ',
  syu: 'しゅ',
  syo: 'しょ',
  sha: 'しゃ',
  shu: 'しゅ',
  sho: 'しょ',
  tya: 'ちゃ',
  tyu: 'ちゅ',
  tyo: 'ちょ',
  cya: 'ちゃ',
  cyu: 'ちゅ',
  cyo: 'ちょ',
  cha: 'ちゃ',
  chu: 'ちゅ',
  cho: 'ちょ',
  nya: 'にゃ',
  nyu: 'にゅ',
  nyo: 'にょ',
  hya: 'ひゃ',
  hyu: 'ひゅ',
  hyo: 'ひょ',
  mya: 'みゃ',
  myu: 'みゅ',
  myo: 'みょ',
  rya: 'りゃ',
  ryu: 'りゅ',
  ryo: 'りょ',
  gya: 'ぎゃ',
  gyu: 'ぎゅ',
  gyo: 'ぎょ',
  jya: 'じゃ',
  jyu: 'じゅ',
  jyo: 'じょ',
  ja: 'じゃ',
  ju: 'じゅ',
  jo: 'じょ',
  bya: 'びゃ',
  byu: 'びゅ',
  byo: 'びょ',
  pya: 'ぴゃ',
  pyu: 'ぴゅ',
  pyo: 'ぴょ',
  dya: 'ぢゃ',
  dyu: 'ぢゅ',
  dyo: 'ぢょ',
}

const KEYS = Object.keys(ROMAJI).sort((a, b) => b.length - a.length)
const VOWELS = 'aiueo'
const CONSONANTS = 'bcdfghjklmnpqrstvwxyz'

const SHIFT: Record<string, string> = {}
for (const ch of VOWELS + CONSONANTS) SHIFT[ch] = ch.toUpperCase()

const PHYSICAL: Record<string, string> = {}
for (const ch of 'abcdefghijklmnopqrstuvwxyz') PHYSICAL[ch] = ch

const ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
]

const SYMBOL_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['、', '。', '？', '！', '「', '」', '（', '）', 'ー', '・'],
  ['〜', '…', '『', '』', '【', '】', '＋', '＝', '／', '＼'],
]

const SYMBOLS = SYMBOL_ROWS.flat()

function matchKey(buffer: string, i: number): string | undefined {
  return KEYS.find((key) => buffer.startsWith(key, i))
}

function stepN(buffer: string, i: number): { kana: string; next: number } | undefined {
  const next = buffer[i + 1]
  if (next === undefined) return undefined
  if (next === 'n') return { kana: 'ん', next: i + 2 }
  const key = matchKey(buffer, i)
  if (next === 'y') {
    return key && key[1] === 'y' ? { kana: ROMAJI[key]!, next: i + key.length } : undefined
  }
  if (VOWELS.includes(next)) {
    return key ? { kana: ROMAJI[key]!, next: i + key.length } : undefined
  }
  return { kana: 'ん', next: i + 1 }
}

function step(buffer: string, i: number): { kana: string; next: number } | undefined {
  const ch = buffer[i]!
  if (ch === 'n') return stepN(buffer, i)
  if (ch === buffer[i + 1] && CONSONANTS.includes(ch)) return { kana: 'っ', next: i + 1 }
  const key = matchKey(buffer, i)
  return key ? { kana: ROMAJI[key]!, next: i + key.length } : undefined
}

function convert(buffer: string): { kana: string; rest: string } {
  let kana = ''
  let i = 0
  while (i < buffer.length) {
    const out = step(buffer, i)
    if (!out) break
    kana += out.kana
    i = out.next
  }
  return { kana, rest: buffer.slice(i) }
}

function push(state: ImeState, ch: string): ImeState {
  const { kana, rest } = convert(state.buffer + ch)
  return { ...state, preedit: state.preedit + kana, buffer: rest, candidates: [] }
}

function back(state: ImeState): ImeState {
  if (state.buffer) return { ...state, buffer: state.buffer.slice(0, -1) }
  if (state.preedit) return { ...state, preedit: state.preedit.slice(0, -1) }
  if (!state.value) return state
  return { ...state, value: state.value.slice(0, -1) }
}

function commit(state: ImeState, space: boolean): ImeState {
  const { kana, rest } = convert(state.buffer)
  const chosen = state.candidates[0] ?? state.preedit + kana + rest
  return {
    value: state.value + chosen + (space ? ' ' : ''),
    preedit: '',
    buffer: '',
    candidates: [],
  }
}

function insert(state: ImeState, ch: string): ImeState {
  const done = commit(state, false)
  return { ...done, value: done.value + ch }
}

function press(state: ImeState, key: string): ImeState {
  const ch = key.length === 1 ? key.toLowerCase() : key
  if (ch === BACKSPACE) return back(state)
  if (ch === CLEAR) return { ...state, preedit: '', buffer: '', candidates: [] }
  if (ch === SPACE) return commit(state, true)
  if (ch === ENTER) return commit(state, false)
  if (SYMBOLS.includes(ch)) return insert(state, ch)
  const letter = ch.length === 1 && (CONSONANTS.includes(ch) || VOWELS.includes(ch))
  return letter ? push(state, ch) : state
}

export const kana: ImeEngine = {
  id: 'kana',
  language: 'ja',
  label: 'かな',
  letters: 'かな',
  columns: 10,
  rows: ROWS,
  symbols: SYMBOL_ROWS,
  shift: SHIFT,
  physical: PHYSICAL,
  initial: emptyState,
  press,
  finish: (state) => {
    const { kana: k, rest } = convert(state.buffer)
    return state.value + (state.candidates[0] ?? state.preedit + k + rest)
  },
}
