/** Pure derivations for the settings screen. No runes, no DOM. */

import type { ExerciseInfo } from './types'

/** How each exercise modality reads in the Study checklist. */
export const MODALITY_LABEL: Record<string, string> = {
  text: 'Reading & writing',
  voice: 'Listening & speaking',
  mixed: 'Mixed / conversation',
  chat: 'Conversation',
}

/** Drill exercises grouped by modality, in first-seen order. */
export function drillGroupsOf(
  exercises: ExerciseInfo[],
): { modality: string; items: ExerciseInfo[] }[] {
  const order: string[] = []
  const byMod = new Map<string, ExerciseInfo[]>()
  for (const ex of exercises) {
    if (ex.id === 'introduce') continue // first-exposure step, never a drill
    if (!byMod.has(ex.modality)) {
      byMod.set(ex.modality, [])
      order.push(ex.modality)
    }
    byMod.get(ex.modality)!.push(ex)
  }
  return order.map((modality) => ({ modality, items: byMod.get(modality)! }))
}
