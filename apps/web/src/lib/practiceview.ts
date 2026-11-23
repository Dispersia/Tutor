import type { CurriculumDeck, LessonDTO } from './curriculum'
import type { SrsOutcome } from './exercises'
import { href } from './paths'

const RATING_NAMES = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' } as const

export function lessonLabel(l: LessonDTO): string {
  if (l.level === 'zhfreq' || l.level === 'jafreq') return 'Frequency'
  return l.level.length > 12 ? 'Deck' : l.level.toUpperCase()
}

export function reviewLabel(s: SrsOutcome, now: number = Date.now()): string {
  const rating = RATING_NAMES[s.rating]
  if (s.state === 'learning' || s.state === 'relearning') {
    const mins = Math.max(1, Math.round((s.dueAt - now) / 60_000))
    return `${rating} · again in ${mins} min`
  }
  const d = s.intervalDays
  return `${rating} · next in ${d} day${d === 1 ? '' : 's'}`
}

export function nextLessonAfter(curriculum: CurriculumDeck[], id: string): string | undefined {
  const deck = curriculum.find((d) => d.lessons.some((l) => l.id === id))
  if (!deck) return undefined
  const idx = deck.lessons.findIndex((l) => l.id === id)
  if (idx < 0) return undefined
  return deck.lessons.slice(idx + 1).find((l) => !l.complete)?.id
}

export function quietClock(until: number, now: number): string {
  const s = Math.max(0, Math.ceil((until - now) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export interface NextDrillRequest {
  actionId?: string
  choiceId?: string
  lessonId?: string
  deckId: string
}

export function nextDrillBody(p: NextDrillRequest): {
  actionId?: string
  lessonId?: string
  deckId?: string
  choiceId?: string
} {
  const body: { actionId?: string; lessonId?: string; deckId?: string; choiceId?: string } = {}
  if (p.actionId) body.actionId = p.actionId
  if (p.actionId && p.choiceId) body.choiceId = p.choiceId
  if (p.lessonId) body.lessonId = p.lessonId
  if (!p.actionId && !p.lessonId && p.deckId) body.deckId = p.deckId
  return body
}

export function nextLessonTitleOf(curriculum: CurriculumDeck[], id: string | undefined): string {
  const next = curriculum.flatMap((d) => d.lessons).find((l) => l.id === id)
  return next?.newWord ?? next?.title ?? ''
}

export function practiceLessonHref(id: string, actionId?: string): string {
  const query = new URLSearchParams({ lesson: id })
  if (actionId) query.set('action', actionId)
  return href(`/practice?${query.toString()}`)
}

export interface AnswerBody {
  exerciseId: string
  cardId: string
  answer: unknown
  latencyMs?: number
  actionId?: string
  lessonId?: string
  choiceId?: string
}

export function answerBody(p: {
  instance: { exerciseId: string; cardId: string }
  answer: unknown
  startedAt: number
  actionId?: string
  lessonId?: string
  choiceId?: string
}): AnswerBody {
  return {
    exerciseId: p.instance.exerciseId,
    cardId: p.instance.cardId,
    answer: p.answer,
    latencyMs: Date.now() - p.startedAt,
    actionId: p.actionId,
    lessonId: p.lessonId,
    choiceId: p.choiceId,
  }
}

export function speakForm(p: {
  blob: Blob
  isRetry: boolean
  instance: { exerciseId: string; cardId: string }
  startedAt: number
  actionId?: string
  lessonId?: string
  choiceId?: string
}): FormData {
  const form = new FormData()
  form.set('file', p.blob, 'clip.webm')
  form.set('cardId', p.instance.cardId)
  form.set('exerciseId', p.instance.exerciseId)
  form.set('latencyMs', String(Date.now() - p.startedAt))
  if (p.isRetry) form.set('retry', 'true')
  if (p.actionId) form.set('actionId', p.actionId)
  if (p.choiceId) form.set('choiceId', p.choiceId)
  if (p.lessonId) form.set('lessonId', p.lessonId)
  return form
}
