import type { AssessResult } from '@tutor/core'

/**
 * Grades one recorded attempt against the expected text (DESIGN §9.4). A leaf
 * type, so `Deps` can name it without importing the evaluator implementation.
 */
export type AssessFn = (audio: Uint8Array, expected: string) => Promise<AssessResult>
