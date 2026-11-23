export type SkillCategory = 'gathering' | 'artisan' | 'support' | 'combat'

export interface CategoryStyle {
  label: string
  accent: string
  tint: string
}

export const CATEGORY: Record<SkillCategory, CategoryStyle> = {
  gathering: { label: 'Gathering', accent: 'oklch(0.77 0.12 165)', tint: 'rgba(110,214,170,0.14)' },
  artisan: { label: 'Artisan', accent: 'oklch(0.79 0.125 78)', tint: 'rgba(214,178,104,0.14)' },
  support: { label: 'Support', accent: 'oklch(0.74 0.12 305)', tint: 'rgba(186,150,232,0.14)' },
  combat: { label: 'Combat', accent: 'oklch(0.71 0.15 25)', tint: 'rgba(232,132,116,0.14)' },
}

export const ACCENT = {
  seal: 'oklch(0.71 0.15 285)',
  gold: 'oklch(0.85 0.13 93)',
  xp: 'oklch(0.85 0.13 93)',
  jade: 'oklch(0.77 0.12 165)',
  green: 'oklch(0.77 0.12 165)',
  health: 'oklch(0.77 0.12 165)',
  player: 'oklch(0.77 0.12 165)',
  brass: 'oklch(0.79 0.125 78)',
  streak: 'oklch(0.79 0.125 78)',
  azure: 'oklch(0.76 0.11 240)',
  arcane: 'oklch(0.76 0.11 240)',
  level: 'oklch(0.76 0.11 240)',
  violet: 'oklch(0.74 0.12 305)',
  ember: 'oklch(0.71 0.15 25)',
  warn: 'oklch(0.79 0.125 78)',
  ink: 'oklch(0.585 0.032 280)',
} as const

export const KIND_ACCENT: Record<string, string> = {
  chat: ACCENT.azure,
  voice: ACCENT.violet,
  lesson: ACCENT.jade,
}

export const accentStyle = (color: string) => `--accent: ${color}`

export const categoryAccent = (cat: string): string =>
  CATEGORY[cat as SkillCategory]?.accent ?? ACCENT.azure

export const TIER: Record<string, string> = {
  raw: 'oklch(0.71 0.026 280)',
  refined: 'oklch(0.76 0.11 240)',
  equipment: 'oklch(0.85 0.13 93)',
  consumable: 'oklch(0.77 0.12 165)',
  coin: 'oklch(0.79 0.125 78)',
  other: 'oklch(0.71 0.026 280)',
}

export const tierAccent = (tier?: string | null): string => TIER[tier ?? 'other'] ?? TIER.other!

export const QUALITY: Record<string, string> = {
  common: 'oklch(0.76 0.024 280)',
  uncommon: 'oklch(0.73 0.12 145)',
  rare: 'oklch(0.7 0.12 250)',
  epic: 'oklch(0.68 0.15 305)',
}

export const qualityAccent = (quality?: string | null): string =>
  QUALITY[quality ?? 'common'] ?? QUALITY.common!
