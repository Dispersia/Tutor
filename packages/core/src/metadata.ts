/**
 * Card metadata (docs/DESIGN.md §11.1).
 *
 * A card's *content* (`front`, `back`, `readings`, `payload`) is
 * language-agnostic: it is named by role, never by script, so the same "vocab"
 * template works for Mandarin, Japanese or Spanish. Metadata is the escape
 * hatch for the annotations that don't fit those roles — the things that are
 * specific to one language or one deck: Japanese pitch accent, tone contours,
 * stroke order, radicals, frequency rank, mnemonics, audio references.
 *
 * Keys are plain names and a value is `unknown` on purpose, so a new annotation
 * kind never needs a schema change. One shape is built in because the app knows
 * how to render it:
 *
 *   pitch  — a pitch contour over the card's syllables/moras. It describes the
 *            *shape* of the pitch, not how any one language realises it, so it
 *            covers Japanese pitch accent (高低アクセント) and tone contours
 *            alike.
 *
 * Anything else lives under its own key and is only read by the UI that
 * understands it. Metadata never affects grading — the card's `readings` and
 * `back` stay the source of truth for correctness.
 */

/** One step of a pitch contour. */
export type PitchLevel = 'H' | 'L'

/**
 * A pitch contour for a word: one level per syllable/mora, in order.
 *
 * Japanese example — かみさま (LHHL, accent on the third mora):
 * ```ts
 * { syllables: ['か', 'み', 'さ', 'ま'], levels: ['L', 'H', 'H', 'L'], drop: 3 }
 * ```
 */
export interface PitchContour {
  /** One level per syllable/mora, e.g. `['L', 'H', 'H', 'L']`. */
  levels: PitchLevel[]
  /**
   * The accent nucleus: the mora *after which* the pitch falls, counted from 1
   * (the Japanese accent number). `0`/absent means no in-word drop (平板
   * heiban). The UI marks the fall between mora `drop` and `drop + 1`.
   */
  drop?: number | null
  /**
   * The syllable/mora texts the levels describe (kana for Japanese). When
   * absent the UI falls back to one level per character of the reading.
   */
  syllables?: string[]
}

/**
 * Language-specific annotations attached to a card. Extensible by convention:
 * a new key needs no change here.
 */
export interface CardMetadata {
  /** Pitch contour of the card's word (Japanese pitch accent, tone contour, …). */
  pitch?: PitchContour
  /** Any other annotation, keyed by convention (e.g. `strokeOrder`, `radical`). */
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

/**
 * Derives the mora levels from a Japanese accent number + mora count.
 * `0` is heiban (no in-word drop), `1` is atamadaka, `N` drops after mora N.
 */
export function pitchFromAccent(accent: number, moraCount: number): PitchLevel[] {
  const levels: PitchLevel[] = []
  for (let i = 0; i < moraCount; i++) {
    const high = i === 0 ? accent === 1 : accent === 0 || i < accent
    levels.push(high ? 'H' : 'L')
  }
  return levels
}

/**
 * Normalises whatever a producer gave us (an LLM, an import, an editor) into a
 * `PitchContour`. Accepts a `"LHHL"` string, an explicit `{ levels }`, or a
 * `{ accent, syllables }` pair. Returns `undefined` when there is no usable
 * contour, so callers can simply drop the metadata.
 */
export function parsePitchContour(raw: unknown): PitchContour | undefined {
  if (!raw) return undefined
  // "LHHL" / "HLL" shorthand.
  if (typeof raw === 'string') return fromString(raw)
  if (typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const syllables = syllablesOf(o)
  const drop = dropOf(o)
  let levels = levelsOf(o)
  // No explicit levels: derive them from the accent number if we know the count.
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

/** Reads a card's pitch contour out of its metadata, if any. */
export function pitchOf(metadata: CardMetadata | undefined): PitchContour | undefined {
  return parsePitchContour(metadata?.pitch)
}
