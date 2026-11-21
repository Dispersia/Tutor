/** Shared palette helpers for the Nightforge theme (apps/web/src/app.css). */

export type SkillCategory = 'gathering' | 'artisan' | 'support' | 'combat'

export interface CategoryStyle {
  label: string
  /** accent colour (matches the CSS custom properties) */
  accent: string
  /** soft tint */
  tint: string
}

export const CATEGORY: Record<SkillCategory, CategoryStyle> = {
  gathering: { label: 'Gathering', accent: 'oklch(0.73 0.1 158)', tint: 'rgba(122,196,158,0.14)' },
  artisan: { label: 'Artisan', accent: 'oklch(0.76 0.1 68)', tint: 'rgba(200,168,104,0.14)' },
  support: { label: 'Support', accent: 'oklch(0.71 0.1 300)', tint: 'rgba(176,148,214,0.14)' },
  combat: { label: 'Combat', accent: 'oklch(0.66 0.14 25)', tint: 'rgba(196,116,110,0.14)' },
}

/** Named roles. Colour always means the same thing. */
export const ACCENT = {
  /** the one action that moves forward */
  seal: 'oklch(0.7 0.145 52)',
  /** numbers the player earned */
  gold: 'oklch(0.8 0.105 88)',
  xp: 'oklch(0.8 0.105 88)',
  /** what grows: goal, health, success */
  jade: 'oklch(0.73 0.1 158)',
  green: 'oklch(0.73 0.1 158)',
  health: 'oklch(0.73 0.1 158)',
  player: 'oklch(0.73 0.1 158)',
  /** streak, artisan, coins */
  brass: 'oklch(0.76 0.1 68)',
  streak: 'oklch(0.76 0.1 68)',
  /** the academy: arcane, levels, chat */
  azure: 'oklch(0.73 0.1 245)',
  arcane: 'oklch(0.73 0.1 245)',
  level: 'oklch(0.73 0.1 245)',
  /** talents and support */
  violet: 'oklch(0.71 0.1 300)',
  /** damage and danger */
  ember: 'oklch(0.66 0.14 25)',
  /** errors that need attention */
  warn: 'oklch(0.76 0.1 68)',
  /** neutral — quiet pills and labels that are not a role (item tier, counts) */
  ink: 'oklch(0.58 0.012 258)',
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
  raw: 'oklch(0.7 0.01 258)',
  refined: 'oklch(0.73 0.1 245)',
  equipment: 'oklch(0.8 0.105 88)',
  consumable: 'oklch(0.73 0.1 158)',
  coin: 'oklch(0.76 0.1 68)',
  other: 'oklch(0.7 0.01 258)',
}

export const tierAccent = (tier?: string | null): string => TIER[tier ?? 'other'] ?? TIER.other!
