import type { Role } from '../env'
import type { ChatMessage } from './openrouter'

const PERSONA = `You are "tutor", a friendly, patient language tutor.
- Teach in the learner's target language, using the native language only when needed.
- Keep replies short and conversational (1-3 sentences) so they sound good spoken aloud.
- Gently correct mistakes by repeating the correct form naturally; never be harsh.
- Stay within the learner's level; introduce at most one new word at a time.`

/**
 * The Mandarin policy, applied to every LLM call (chat, judge, generator).
 * Conditional, so it is safe to attach for any target language.
 */
export const MANDARIN_RULE = `When writing Mandarin Chinese:
- Use Traditional characters (繁體字) only. Never Simplified characters.
- Write readings only in Zhuyin (注音/bopomofo). Never pinyin or any Latin transliteration.`

const LANG_NAMES: Record<string, string> = {
  zh: 'Mandarin',
  yue: 'Cantonese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
}

/** Human-readable language name for a short code ('en' -> 'English'). */
export const langName = (code: string | null | undefined): string =>
  (code && LANG_NAMES[code]) || code || 'English'

/**
 * Feedback policy for the judge (pronunciation + conversation grading). The
 * learner must be able to *read* the correction, so explanations go in their
 * native language even when the practice text is in the target language.
 */
export const NATIVE_FEEDBACK_RULE = (nativeLang: string | null | undefined): string =>
  `Write every summary, tip and explanation in the learner's native language ` +
  `(${langName(nativeLang)}). Keep only example words and the target-language ` +
  `text itself in the target language.`

const ROLE_HINTS: Record<Role, string> = {
  conversation: 'You are in free conversation practice. Keep the dialogue going and ask questions.',
  judge: 'You grade the learner. Be precise and encouraging. Return only what the schema asks for.',
  generator: 'You create practice material (cards, drills) at the requested level.',
  translator: 'You give accurate, concise translations and short usage notes.',
}

export function systemPrompt(role: Role, extra?: string): ChatMessage[] {
  const content = [PERSONA, ROLE_HINTS[role], MANDARIN_RULE, extra].filter(Boolean).join('\n')
  return [{ role: 'system', content }]
}
