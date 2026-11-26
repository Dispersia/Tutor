import { bopomofo } from './bopomofo'
import { lookupCandidates } from './candidates'
import { hangul } from './hangul'
import { kana } from './kana'
import { latin } from './latin'
import type { ImeEngine } from './types'

export interface ImeOptions {
  variant?: string
}

const LATIN = new Set(['en', 'es', 'de', 'fr', 'it', 'pt'])

function baseFor(lang: string, opts: ImeOptions): ImeEngine | undefined {
  if (lang === 'ko') return hangul
  if (lang === 'ja') return kana
  if (lang === 'zh') return opts.variant === 'simplified' ? undefined : bopomofo
  if (LATIN.has(lang)) return latin
  return undefined
}

export function imeFor(
  lang: string | null | undefined,
  opts: ImeOptions = {},
): ImeEngine | undefined {
  if (!lang) return undefined
  const engine = baseFor(lang, opts)
  if (!engine) return undefined
  if (engine.id === 'bopomofo' || engine.id === 'kana') {
    return { ...engine, lookup: (state) => lookupCandidates(lang, state.preedit) }
  }
  return engine
}
