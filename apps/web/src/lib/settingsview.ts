import type { ExerciseInfo, Role, Roles } from './types'

export const ROLE_KEYS: Role[] = ['conversation', 'judge', 'generator', 'translator']

export const ROLE_LABEL: Record<Role, string> = {
  conversation: 'Conversation',
  judge: 'Grading / judge',
  generator: 'Card & exercise generator',
  translator: 'Translator / lookups',
}

export const EMPTY_ROLES: Roles = { conversation: '', judge: '', generator: '', translator: '' }

export const MODALITY_LABEL: Record<string, string> = {
  text: 'Reading & writing',
  voice: 'Listening & speaking',
  mixed: 'Mixed / conversation',
  chat: 'Conversation',
}

export function drillGroupsOf(
  exercises: ExerciseInfo[],
): { modality: string; items: ExerciseInfo[] }[] {
  const order: string[] = []
  const byMod = new Map<string, ExerciseInfo[]>()
  for (const ex of exercises) {
    if (ex.id === 'introduce') continue
    if (!byMod.has(ex.modality)) {
      byMod.set(ex.modality, [])
      order.push(ex.modality)
    }
    byMod.get(ex.modality)!.push(ex)
  }
  return order.map((modality) => ({ modality, items: byMod.get(modality)! }))
}
