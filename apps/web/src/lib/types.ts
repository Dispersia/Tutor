export interface PublicUser {
  id: string
  username: string | null
  handle: string
  role: string
  nativeLang: string
  targetLang: string | null
  level: string | null
  createdAt: number
}

export interface ChatSession {
  id: string
  kind: string
  lang: string | null
  title: string | null
  startedAt: number
  endedAt: number | null
}

export interface Message {
  id: string
  sessionId: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  text: string
  model: string | null
  tokensIn: number | null
  tokensOut: number | null
  costUsd: number | null
  createdAt: number
}

export interface ModelInfo {
  id: string
  name: string
  contextLength: number
  promptPricePerM: number
  completionPricePerM: number
  outputModalities: string[]
}

export type Role = 'conversation' | 'judge' | 'generator' | 'translator'

export interface Roles extends Record<Role, string> {}

export type ModKind = 'yield' | 'double' | 'xp' | 'global_xp' | 'damage' | 'drop' | 'hp' | 'coins'

export interface SpeechStatus {
  running: boolean
  ready: boolean
  models: string[]
  url: string
  idleForMs: number
  idleTimeoutMs: number
}
