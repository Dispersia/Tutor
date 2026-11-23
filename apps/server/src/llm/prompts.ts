/**
 * The shared pieces of every prompt the app sends to a language model
 * (docs/DESIGN.md §10.3): language names, the script rule, and the system
 * prompts for chat and grading.
 *
 * Written for small models. Each prompt says who the model is, what it gets,
 * what to return, and the few rules that matter — once, as positive
 * instructions. A rule that only applies to some languages is only attached for
 * those languages: a model told about Zhuyin while teaching Japanese follows it.
 */

import type { Role } from '../env'
import type { ChatMessage } from './openrouter'

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

/** How a deck (or, with no deck, the app's default) writes the target language. */
export interface ScriptPrefs {
  variant?: 'traditional' | 'simplified'
  /** `zhuyin` | `pinyin` for Chinese, `kana` | `romaji` for Japanese. */
  readingScript?: string
}

const READING_NAMES: Record<string, string> = {
  zhuyin: 'Zhuyin (注音, bopomofo)',
  pinyin: 'pinyin with tone marks',
  kana: 'kana',
  romaji: 'romaji',
}

/**
 * The one script rule for a target language: which characters to write and what
 * a reading looks like. Empty for a language with nothing to pin down. The app's
 * defaults are Traditional characters with Zhuyin, and kana for Japanese.
 */
export function scriptRule(targetLang: string | null | undefined, prefs: ScriptPrefs = {}): string {
  const script = readingScriptOf(targetLang, prefs)
  const reading = script
    ? `A ${langName(targetLang)} reading is written in ${READING_NAMES[script] ?? script} and nothing else.`
    : ''
  return [characterRule(targetLang, prefs), reading].filter(Boolean).join(' ')
}

/** Which characters to write — the half of the script rule that matters for prose. */
export function characterRule(
  targetLang: string | null | undefined,
  prefs: ScriptPrefs = {},
): string {
  if (targetLang !== 'zh' && targetLang !== 'yue') return ''
  const chars =
    prefs.variant === 'simplified'
      ? 'Simplified characters (简体字), never Traditional'
      : 'Traditional characters (繁體字), never Simplified'
  return `Write ${langName(targetLang)} in ${chars}.`
}

/** Cantonese has no default reading script: only a deck that names one gets the clause. */
function readingScriptOf(
  targetLang: string | null | undefined,
  prefs: ScriptPrefs,
): string | undefined {
  if (prefs.readingScript) return prefs.readingScript
  if (targetLang === 'zh') return 'zhuyin'
  if (targetLang === 'ja') return 'kana'
  return undefined
}

/**
 * Feedback policy for a grader: the learner has to be able to *read* the
 * correction, so it is written in their native language even when the practised
 * text is in the target language.
 */
export const NATIVE_FEEDBACK_RULE = (
  nativeLang: string | null | undefined,
  targetLang?: string | null,
): string => {
  const native = langName(nativeLang)
  const target = targetLang ? langName(targetLang) : 'the language being practised'
  return (
    `Write all feedback in ${native}, the learner's native language. Quote words ` +
    `and example sentences in ${target} as they are, but explain them in ${native}.`
  )
}

/**
 * A one-line reminder appended to a grading request, so the language rule is the
 * last thing a small model reads (it otherwise drifts into the target language).
 */
export const NATIVE_FEEDBACK_REMINDER = (
  nativeLang: string | null | undefined,
  targetLang?: string | null,
): string =>
  `Write the feedback in ${langName(nativeLang)}` +
  (targetLang ? `, not in ${langName(targetLang)}` : '') +
  '.'

/** Who the model is talking to and about, for the chat and grading prompts. */
export interface Learner {
  nativeLang: string | null | undefined
  targetLang: string | null | undefined
  /** Free text from the profile ("beginner", "HSK 2"); a beginner when unset. */
  level?: string | null
}

/**
 * The conversation tutor. Its reply is spoken aloud sentence by sentence, so the
 * prompt asks for plain speakable text: markup, emoji and bracketed readings are
 * read out literally (or garbled) by the speech model.
 */
export function conversationSystem(learner: Learner): string {
  const target = langName(learner.targetLang)
  const native = langName(learner.nativeLang)
  return lines(
    `You are a friendly ${target} conversation partner for a learner (level: ${learner.level?.trim() || 'beginner'}) whose native language is ${native}. Everything you write is read aloud by a text-to-speech voice.`,
    '',
    'How to reply:',
    `- Speak ${target}: one to three short sentences, ending with a simple question that keeps the conversation going.`,
    "- Use common, everyday words at the learner's level. Introduce at most one new word per reply.",
    `- When the learner makes a mistake, use the corrected form naturally in your reply. Add one short sentence of explanation in ${native} only if the mistake would otherwise be repeated.`,
    `- When the learner writes in ${native} or asks what something means, answer in one sentence of ${native}, then carry on in ${target}.`,
    '',
    'Because the reply is spoken:',
    '- Write plain sentences only: no markdown, lists, emoji, brackets or stage directions.',
    '- Do not add readings or romanization after a word.',
    bullet(characterRule(learner.targetLang)),
  )
}

/** The system prompt for the answer graders (translate, converse, pronunciation). */
export function judgeSystem(learner: Learner): string {
  return lines(
    'You grade one answer from a language learner. Return only the JSON the schema asks for.',
    `- ${NATIVE_FEEDBACK_RULE(learner.nativeLang, learner.targetLang)}`,
    '- Feedback is one or two short sentences spoken to the learner as "you": kind, specific, no markdown.',
    '- Grade what the task asks about and nothing else.',
    bullet(scriptRule(learner.targetLang)),
  )
}

const ROLE_TASK: Record<Exclude<Role, 'conversation'>, string> = {
  judge: 'You grade a language learner. Be precise and kind, and return only what is asked for.',
  generator:
    'You write practice material for a language learner: accurate, natural, and no harder than the request asks.',
  translator:
    'You translate for a language learner: give the natural meaning of the whole phrase, briefly.',
}

/** The system message for a chat-style call in a given role. */
export function systemPrompt(role: Role, learner: Learner, extra?: string): ChatMessage[] {
  const base =
    role === 'conversation'
      ? conversationSystem(learner)
      : lines(
          ROLE_TASK[role],
          NATIVE_FEEDBACK_RULE(learner.nativeLang, learner.targetLang),
          scriptRule(learner.targetLang) || undefined,
        )
  return [{ role: 'system', content: lines(base, extra) }]
}

const bullet = (rule: string): string | undefined => (rule ? `- ${rule}` : undefined)

/** Joins the parts that are present ('' keeps a blank line; false/undefined drop). */
function lines(...parts: (string | false | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === 'string').join('\n')
}
