import type { App } from '../../context'
import { registerCatalog } from './catalog'
import { registerGrade } from './grade'
import { registerNext } from './next'
import { registerSpeak } from './speak'
import { registerStudyMore } from './studyMore'

export function registerPractice(app: App) {
  registerCatalog(app)
  registerNext(app)
  registerGrade(app)
  registerSpeak(app)
  registerStudyMore(app)
}

export { type SessionUser, pickNextExercise, pickReviewCard, studyDeckId } from './select'
export { exerciseCtx } from './exerciseCtx'
