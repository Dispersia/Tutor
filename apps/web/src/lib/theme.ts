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
  gathering: { label: 'Gathering', accent: '#5cc46a', tint: 'rgba(92,196,106,0.14)' },
  artisan: { label: 'Artisan', accent: '#e6a83c', tint: 'rgba(230,168,60,0.14)' },
  support: { label: 'Support', accent: '#a97fe0', tint: 'rgba(169,127,224,0.14)' },
  combat: { label: 'Combat', accent: '#e05858', tint: 'rgba(224,88,88,0.14)' },
}

export const ACCENT = {
  xp: '#e8c15a',
  streak: '#e6a83c',
  level: '#5b9be0',
  arcane: '#5b9be0',
  gold: '#e8c15a',
  green: '#5cc46a',
  health: '#e05858',
  player: '#5cc46a',
}

/** The `--accent` style string a component can spread onto an element. */
export const accentStyle = (color: string) => `--accent: ${color}`

export const categoryAccent = (cat: string): string =>
  CATEGORY[cat as SkillCategory]?.accent ?? ACCENT.arcane

/** Item-tier colours (raw/refined/equipment/consumable/coin/other). */
export const TIER: Record<string, string> = {
  raw: '#8b95aa',
  refined: '#5b9be0',
  equipment: '#e8c15a',
  consumable: '#5cc46a',
  coin: '#e6a83c',
  other: '#8b95aa',
}

export const tierAccent = (tier?: string | null): string => TIER[tier ?? 'other'] ?? TIER.other!
