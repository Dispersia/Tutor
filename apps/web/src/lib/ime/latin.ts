import { BACKSPACE, CLEAR, ENTER, SPACE, emptyState, type ImeEngine, type ImeState } from './types'

const ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
]

const SHIFT: Record<string, string> = {}
for (const ch of 'abcdefghijklmnopqrstuvwxyz') SHIFT[ch] = ch.toUpperCase()

function press(state: ImeState, key: string): ImeState {
  if (key === BACKSPACE) return { ...state, value: state.value.slice(0, -1) }
  if (key === CLEAR) return { ...state, value: '', preedit: '', buffer: '', candidates: [] }
  if (key === SPACE) return { ...state, value: `${state.value} ` }
  if (key === ENTER) return state
  return { ...state, value: state.value + key }
}

export const latin: ImeEngine = {
  id: 'latin',
  language: 'en',
  label: 'English',
  columns: 10,
  rows: ROWS,
  shift: SHIFT,
  initial: emptyState,
  press,
  finish: (state) => state.value,
}
