import type { CurriculumDeck } from './curriculum'
import type { SkillsResponse } from './skills'
import { ACCENT } from './theme'
import { langName } from './voices'

const LANGUAGE_CODES = ['zh', 'ja', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'ru'] as const

export const LANGUAGES = LANGUAGE_CODES.map((code) => ({ code, label: langName(code) }))

const rank = (level: string | null): number => (level === 'zhfreq' ? 0 : level === 'jafreq' ? 1 : 2)

export function orderDecks(list: CurriculumDeck[], activeDeckId: string | null): CurriculumDeck[] {
  const lead = (d: CurriculumDeck) => (d.deckId === activeDeckId ? 0 : 1)
  return list.sort((a, b) => lead(a) - lead(b) || rank(a.level) - rank(b.level))
}

export const deckAccent = (level: string | null): string =>
  level === 'zhfreq' ? ACCENT.green : level === 'jafreq' ? ACCENT.level : ACCENT.arcane

export const nextLesson = (d: CurriculumDeck) =>
  d.lessons.find((l) => !l.complete) ?? d.lessons[d.lessons.length - 1]

export const isDeckDone = (d: CurriculumDeck): boolean =>
  d.cardCount > 0 && d.learned >= d.cardCount

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

export function groupedActions(ref: SkillsResponse | null) {
  return (ref?.skills ?? [])
    .map((skill) => ({
      skill,
      actions: skill.actions.filter((action) => action.unlocked && action.affordable),
    }))
    .filter((group) => group.actions.length > 0)
}
