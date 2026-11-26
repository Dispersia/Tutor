const MIC_UNAVAILABLE = 'Microphone unavailable — needs HTTPS.'
export const MIC_TOO_QUICK = 'That was too quick — hold the mic and speak.'
export const MIC_NO_SPEECH = 'Didn’t catch that — try again.'

export function micUnavailable(e: unknown): string {
  return `${MIC_UNAVAILABLE} ${(e as Error).message}`
}
