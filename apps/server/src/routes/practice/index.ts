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

export { learnerOf, type SessionUser, pickNextExercise, pickReviewCard, readingMap } from './select'
export { exerciseCtx, showReadingsFor } from './exerciseCtx'
