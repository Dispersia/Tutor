/** The user's voice preferences (docs/DESIGN.md §10.1). */

import { allUserSettings } from '../../db/repo'

export interface VoicePrefs {
  mode: 'preset' | 'design'
  voices: Record<string, string>
}

export function readVoicePrefs(
  db: Parameters<typeof allUserSettings>[0],
  userId: string,
): VoicePrefs {
  const s = allUserSettings(db, userId)
  let voices: Record<string, string>
  try {
    voices = s.voices ? (JSON.parse(s.voices) as Record<string, string>) : {}
  } catch {
    voices = {}
  }
  return { mode: s.voiceMode === 'design' ? 'design' : 'preset', voices }
}
