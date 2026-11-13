/** Deterministic answer grading helpers (used before/without any LLM judge). */

/** Lowercase, strip tone diacritics + punctuation + spaces. */
export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[.,!?;:'"“”‘’。，！？、；：（）()[\]…·\-]/g, '')
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost)
    }
    prev = curr
  }
  return prev[b.length]!
}

/** 0..1 similarity over normalized strings. */
export function similarity(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na && !nb) return 1
  const max = Math.max(na.length, nb.length, 1)
  return 1 - levenshtein(na, nb) / max
}

export interface TextGrade {
  score: number
  correct: boolean
  matched?: string
}

/**
 * Grades a free-text answer against the expected value plus accepted
 * alternatives (e.g. pinyin/romaji readings).
 */
export function gradeText(expected: string, accepted: string[], answer: string): TextGrade {
  const candidates = [expected, ...accepted].filter(Boolean)
  const norm = normalize(answer)
  if (!norm) return { score: 0, correct: false }
  for (const c of candidates) {
    if (normalize(c) === norm) return { score: 100, correct: true, matched: c }
  }
  let best = 0
  let matched: string | undefined
  for (const c of candidates) {
    const s = similarity(c, answer)
    if (s > best) {
      best = s
      matched = c
    }
  }
  const score = Math.round(best * 100)
  return { score, correct: score >= 80, matched }
}

/** Short human hint for the next attempt. */
export function feedbackFor(score: number, expected: string): string | undefined {
  if (score >= 100) return undefined
  if (score >= 80) return `Almost! The answer is ${expected}.`
  if (score >= 50) return `Close — it should be ${expected}.`
  return `Not quite. The answer is ${expected}.`
}
