/** Shared palette helpers for "The Lexicon" theme (apps/web/src/app.css). */

export type SkillCategory = 'gathering' | 'artisan' | 'support' | 'combat'

export interface CategoryStyle {
  label: string
  /** hex accent (matches the CSS custom properties) */
  accent: string
  /** soft tint */
  tint: string
}

export const CATEGORY: Record<SkillCategory, CategoryStyle> = {
  gathering: { label: 'Gathering', accent: '#45c08a', tint: 'rgba(69,192,138,0.14)' },
  artisan: { label: 'Artisan', accent: '#e3a64a', tint: 'rgba(227,166,74,0.14)' },
  support: { label: 'Support', accent: '#ac8be6', tint: 'rgba(172,139,230,0.14)' },
  combat: { label: 'Combat', accent: '#e0655c', tint: 'rgba(224,101,92,0.14)' },
}

/** Named roles. Colour always means the same thing. */
export const ACCENT = {
  /** the one action that moves forward */
  seal: '#e2452b',
  /** numbers the player earned */
  gold: '#eac168',
  xp: '#eac168',
  /** what grows: goal, health, success */
  jade: '#45c08a',
  green: '#45c08a',
  health: '#45c08a',
  player: '#45c08a',
  /** streak, artisan, coins */
  brass: '#e3a64a',
  streak: '#e3a64a',
  /** the academy: arcane, levels, chat */
  azure: '#6aa9e9',
  arcane: '#6aa9e9',
  level: '#6aa9e9',
  /** talents and support */
  violet: '#ac8be6',
  /** damage and danger */
  ember: '#e0655c',
  /** errors that need attention */
  warn: '#e3a64a',
} as const

/** History kinds → accent. */
export const KIND_ACCENT: Record<string, string> = {
  chat: ACCENT.azure,
  voice: ACCENT.violet,
  lesson: ACCENT.jade,
}

/** The `--accent` style string a component can spread onto an element. */
export const accentStyle = (color: string) => `--accent: ${color}`

export const categoryAccent = (cat: string): string =>
  CATEGORY[cat as SkillCategory]?.accent ?? ACCENT.azure

/** Item-tier colours (raw/refined/equipment/consumable/coin/other). */
export const TIER: Record<string, string> = {
  raw: '#8694a1',
  refined: '#6aa9e9',
  equipment: '#eac168',
  consumable: '#45c08a',
  coin: '#e3a64a',
  other: '#8694a1',
}

export const tierAccent = (tier?: string | null): string => TIER[tier ?? 'other'] ?? TIER.other!
