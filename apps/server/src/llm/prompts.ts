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
 *
 * Phrased as an explicit, last-word instruction because the judge is often a
 * small model (e.g. a Qwen one) that otherwise drifts into the target language
 * and explains a Mandarin card in Mandarin.
 */
export const NATIVE_FEEDBACK_RULE = (
  nativeLang: string | null | undefined,
  targetLang?: string | null,
): string => {
  const native = langName(nativeLang)
  const target = targetLang ? langName(targetLang) : 'the language being practised'
  return (
    `Write every summary, tip, correction and explanation in the learner's native ` +
    `language (${native}). Never write the feedback in ${target}; only the words, ` +
    `examples and the practised sentence itself stay in ${target}. If you are ` +
    `unsure which language to use, answer in ${native}.`
  )
}

/**
 * A one-line reminder to append to a judge prompt, right beside the request, so
 * the language rule is the last thing the model reads.
 */
export const NATIVE_FEEDBACK_REMINDER = (
  nativeLang: string | null | undefined,
  targetLang?: string | null,
): string =>
  `Reply in ${langName(nativeLang)} only` +
  (targetLang ? ` — never in ${langName(targetLang)}` : '') +
  '; only the taught words/sentence stay in the target language.'

/**
 * The conversation tutor keeps the *dialogue* in the target language for
 * immersion, but a correction or grammar note the learner has to understand
 * must be written in their native language.
 */
export const CONVERSATION_LANGUAGE_RULE = (
  nativeLang: string | null | undefined,
  targetLang: string | null | undefined,
): string =>
  `Hold the conversation in ${langName(targetLang)}, but write every explanation, ` +
  `correction, grammar note or translation in the learner's native language ` +
  `(${langName(nativeLang)}). Never explain in ${langName(targetLang)}.`

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
