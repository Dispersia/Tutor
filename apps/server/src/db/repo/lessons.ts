/** Guided-curriculum lesson completion. */

import { eq } from 'drizzle-orm'
import type { Db } from '../client'
import { lessonProgress } from '../schema'
import { now } from './helpers'

export function listLessonProgress(db: Db, userId: string) {
  return db.select().from(lessonProgress).where(eq(lessonProgress.userId, userId)).all()
}

export function completeLesson(db: Db, userId: string, lessonId: string): void {
  db.insert(lessonProgress)
    .values({ userId, lessonId, completedAt: now() })
    .onConflictDoNothing()
    .run()
}
