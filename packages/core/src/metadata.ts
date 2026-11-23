export type PitchLevel = 'H' | 'L'

export interface PitchContour {
  levels: PitchLevel[]
  drop?: number | null
  syllables?: string[]
}

export interface CardMetadata {
  pitch?: PitchContour
  [key: string]: unknown
}

const HIGH = /^[Hh↑]|高/
const LOW = /^[Ll↓]|低/

function toLevel(raw: unknown): PitchLevel | undefined {
  if (raw === 'H' || raw === 'L') return raw
  if (typeof raw === 'number') return raw > 0 ? 'H' : 'L'
  if (typeof raw === 'string') {
    if (HIGH.test(raw)) return 'H'
    if (LOW.test(raw)) return 'L'
  }
  return undefined
}

export function pitchFromAccent(accent: number, moraCount: number): PitchLevel[] {
  const levels: PitchLevel[] = []
  for (let i = 0; i < moraCount; i++) {
    const high = i === 0 ? accent === 1 : accent === 0 || i < accent
    levels.push(high ? 'H' : 'L')
  }
  return levels
}

export function parsePitchContour(raw: unknown): PitchContour | undefined {
  if (!raw) return undefined
  if (typeof raw === 'string') return fromString(raw)
  if (typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const syllables = syllablesOf(o)
  const drop = dropOf(o)
  let levels = levelsOf(o)
  if (!levels?.length && typeof drop === 'number' && syllables?.length) {
    levels = pitchFromAccent(drop, syllables.length)
  }
  if (!levels?.length) return undefined
  return {
    levels,
    drop: drop ?? null,
    ...(syllables?.length ? { syllables } : {}),
  }
}

function fromString(raw: string): PitchContour | undefined {
  const levels = [...raw].map(toLevel).filter((l): l is PitchLevel => l === 'H' || l === 'L')
  return levels.length ? { levels, drop: null } : undefined
}

function stringsOf(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : undefined
}

function syllablesOf(o: Record<string, unknown>): string[] | undefined {
  return stringsOf(o.syllables) ?? stringsOf(o.moras)
}

function dropOf(o: Record<string, unknown>): number | undefined {
  return typeof o.drop === 'number' ? o.drop : typeof o.accent === 'number' ? o.accent : undefined
}

function levelsOf(o: Record<string, unknown>): PitchLevel[] | undefined {
  const raw = Array.isArray(o.levels)
    ? o.levels
    : typeof o.pattern === 'string'
      ? [...o.pattern]
      : undefined
  if (!raw) return undefined
  return raw.map(toLevel).filter((l): l is PitchLevel => l === 'H' || l === 'L')
}

export function pitchOf(metadata: CardMetadata | undefined): PitchContour | undefined {
  return parsePitchContour(metadata?.pitch)
}
