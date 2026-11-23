/**
 * The practice routes (docs/ARCHITECTURE.md).
 *
 * One concern per file: `catalog` (the drill catalog + quiet toggle), `next`
 * (serve a drill), `grade` (grade an answer), `speak` (grade recorded audio) and
 * `studyMore` (raise today's allowance). The selectors and the shared exercise
 * context live beside them so combat reuses them unchanged.
 */

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

// Combat imports these from `./practice`; keep that entry point stable.
export { learnerOf, type SessionUser, pickNextExercise, pickReviewCard, readingMap } from './select'
export { exerciseCtx, showReadingsFor } from './exerciseCtx'
