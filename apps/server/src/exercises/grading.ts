import { answerKey, tonelessKey } from '../text/normalize'

const NON_LATIN = /(?!\p{Script=Latin})\p{L}/u

function folderFor(expected: string): (s: string) => string {
  if (!NON_LATIN.test(expected)) return answerKey
  return (s) => (NON_LATIN.test(s) ? answerKey(s) : tonelessKey(s))
}

function gist(s: string): string {
  const bare = s
    .replace(/[(（[][^)）\]]*[)）\]]/g, ' ')
    .trim()
    .replace(/^(?:(?:to|an?|the)\s+)+/i, '')
    .trim()
  return bare || s
}

const NEAR_MISS_MIN_LENGTH = 6
const WRONG_SCORE_CAP = 69

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

export function similarity(a: string, b: string): number {
  const na = tonelessKey(a)
  const nb = tonelessKey(b)
  if (!na && !nb) return 1
  const max = Math.max(na.length, nb.length, 1)
  return 1 - levenshtein(na, nb) / max
}

export function meaningAlternatives(gloss: string): string[] {
  return gloss
    .split(/[/;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export interface TextGrade {
  score: number
  correct: boolean
  matched?: string
}

export function gradeText(
  expected: string,
  accepted: string[],
  answer: string,
  opts: { gloss?: boolean } = {},
): TextGrade {
  const candidates = [expected, ...accepted].filter(Boolean)
  const fold = folderFor(expected)
  const typed = fold(answer)
  if (!typed) return { score: 0, correct: false }
  const key = opts.gloss ? (s: string) => fold(gist(s)) || fold(s) : fold
  const typedKey = key(answer)
  const exact = candidates.find((c) => fold(c) === typed || key(c) === typedKey)
  if (exact !== undefined) return { score: 100, correct: true, matched: exact }
  const shape = (s: string) => ({ key: key(s), words: wordCount(opts.gloss ? gist(s) : s) })
  return closest(
    candidates.map((c) => ({ text: c, ...shape(c) })),
    shape(answer),
  )
}

const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length

interface Shape {
  key: string
  words: number
}

function closest(candidates: (Shape & { text: string })[], typed: Shape): TextGrade {
  let best: TextGrade = { score: 0, correct: false }
  for (const c of candidates) {
    const distance = levenshtein(c.key, typed.key)
    const score = Math.round((1 - distance / Math.max(c.key.length, typed.key.length, 1)) * 100)
    const typo = distance <= 1 && c.key.length >= NEAR_MISS_MIN_LENGTH
    const correct = typo && c.words === typed.words
    const grade = { score: correct ? score : Math.min(score, WRONG_SCORE_CAP), correct }
    if (outranks(grade, best)) best = { ...grade, matched: c.text }
  }
  return best
}

function outranks(a: TextGrade, b: TextGrade): boolean {
  if (a.correct !== b.correct) return a.correct
  return a.score > b.score
}

export function feedbackFor(score: number, expected: string): string | undefined {
  if (score >= 100) return undefined
  if (score >= 80) return `Almost! The answer is ${expected}.`
  if (score >= 50) return `Close — it should be ${expected}.`
  return `Not quite. The answer is ${expected}.`
}
