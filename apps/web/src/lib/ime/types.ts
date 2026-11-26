export const BACKSPACE = '⌫'
export const SPACE = '␣'
export const ENTER = '↵'
export const CLEAR = '✕'

export interface ImeState {
  value: string
  preedit: string
  buffer: string
  candidates: string[]
}

export interface ImeEngine {
  id: string
  language: string
  label: string
  columns: number
  rows: string[][]
  shift?: Record<string, string>
  physical?: Record<string, string>
  initial(): ImeState
  press(state: ImeState, key: string): ImeState
  finish(state: ImeState): string
  lookup?(state: ImeState): Promise<string[]>
}

export function emptyState(): ImeState {
  return { value: '', preedit: '', buffer: '', candidates: [] }
}

export function display(state: ImeState): string {
  return state.value + state.preedit + state.buffer
}
