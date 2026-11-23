import type { AssessResult } from '@tutor/core'

export type AssessFn = (audio: Uint8Array, expected: string) => Promise<AssessResult>
