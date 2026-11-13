/** Shared palette helpers for the idle-RPG theme (apps/web/src/app.css). */

export type SkillCategory = 'gathering' | 'artisan' | 'support' | 'combat'

export interface CategoryStyle {
  label: string
  /** hex accent (matches the CSS custom properties) */
  accent: string
  /** soft tint (unused for now; kept alongside the accent) */
  tint: string
}

export const CATEGORY: Record<SkillCategory, CategoryStyle> = {
  gathering: { label: 'Gathering', accent: '#58c46b', tint: 'rgba(88,196,107,0.14)' },
  artisan: { label: 'Artisan', accent: '#ef9d45', tint: 'rgba(239,157,69,0.14)' },
  support: { label: 'Support', accent: '#b085ef', tint: 'rgba(176,133,239,0.14)' },
  combat: { label: 'Combat', accent: '#ef5f5a', tint: 'rgba(239,95,90,0.14)' },
}

export const ACCENT = {
  xp: '#e8c264',
  streak: '#ef9d45',
  level: '#b085ef',
  arcane: '#4fb0e8',
  gold: '#e8c264',
  health: '#ef5f5a',
  player: '#58c46b',
}

/** The `--accent` style string a component can spread onto an element. */
export const accentStyle = (color: string) => `--accent: ${color}`

export const categoryAccent = (cat: string): string =>
  CATEGORY[cat as SkillCategory]?.accent ?? ACCENT.arcane
