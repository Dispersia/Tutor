/** Pure derivations for the Learn screen: deck order, accents and the path. */

import type { CurriculumDeck } from './curriculum'
import type { SkillsResponse } from './skills'
import { ACCENT } from './theme'

/** The languages a deck can be built for. */
export const LANGUAGES = [
  { code: 'zh', label: 'Mandarin Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' },
] as const

export function langLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code
}

/** A preview cell: the cleaned value of a field, trimmed for display. */
export const cell = (value: string | undefined): string => (value ?? '').slice(0, 40) || '—'

/** The frequency paths sort before generated decks. */
const rank = (level: string | null): number => (level === 'zhfreq' ? 0 : level === 'jafreq' ? 1 : 2)

/** The active deck first; then the frequency path before generated decks. */
export function orderDecks(list: CurriculumDeck[], activeDeckId: string | null): CurriculumDeck[] {
  const lead = (d: CurriculumDeck) => (d.deckId === activeDeckId ? 0 : 1)
  return list.sort((a, b) => lead(a) - lead(b) || rank(a.level) - rank(b.level))
}

/** The stripe colour for a deck, by its path level. */
export const deckAccent = (level: string | null): string =>
  level === 'zhfreq' ? ACCENT.green : level === 'jafreq' ? ACCENT.level : ACCENT.arcane

/** The next step of the path: the first lesson not yet finished. */
export const nextLesson = (d: CurriculumDeck) =>
  d.lessons.find((l) => !l.complete) ?? d.lessons[d.lessons.length - 1]

export const isDeckDone = (d: CurriculumDeck): boolean =>
  d.cardCount > 0 && d.learned >= d.cardCount

/** Actions you can actually train: unlocked and with materials in the bank. */
export function usableActions(ref: SkillsResponse | null): {
  skill: SkillsResponse['skills'][number]
  action: SkillsResponse['skills'][number]['actions'][number]
}[] {
  return (ref?.skills ?? []).flatMap((skill) =>
    skill.actions
      .filter((action) => action.unlocked && action.affordable)
      .map((action) => ({ skill, action })),
  )
}

/** The same actions grouped by profession, for the selector. */
export function groupedActions(ref: SkillsResponse | null) {
  return (ref?.skills ?? [])
    .map((skill) => ({
      skill,
      actions: skill.actions.filter((action) => action.unlocked && action.affordable),
    }))
    .filter((group) => group.actions.length > 0)
}
