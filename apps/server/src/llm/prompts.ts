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

export const langName = (code: string | null | undefined): string =>
  (code && LANG_NAMES[code]) || code || 'English'

export interface ScriptPrefs {
  variant?: 'traditional' | 'simplified'
  readingScript?: string
}

const READING_NAMES: Record<string, string> = {
  zhuyin: 'Zhuyin (注音, bopomofo)',
  pinyin: 'pinyin with tone marks',
  kana: 'kana',
  romaji: 'romaji',
}

export function scriptRule(targetLang: string | null | undefined, prefs: ScriptPrefs = {}): string {
  const script = readingScriptOf(targetLang, prefs)
  const reading = script
    ? `A ${langName(targetLang)} reading is written in ${READING_NAMES[script] ?? script} and nothing else.`
    : ''
  return [characterRule(targetLang, prefs), reading].filter(Boolean).join(' ')
}

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

function readingScriptOf(
  targetLang: string | null | undefined,
  prefs: ScriptPrefs,
): string | undefined {
  if (prefs.readingScript) return prefs.readingScript
  if (targetLang === 'zh') return 'zhuyin'
  if (targetLang === 'ja') return 'kana'
  return undefined
}

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

export const NATIVE_FEEDBACK_REMINDER = (
  nativeLang: string | null | undefined,
  targetLang?: string | null,
): string =>
  `Write the feedback in ${langName(nativeLang)}` +
  (targetLang ? `, not in ${langName(targetLang)}` : '') +
  '.'

export interface Learner {
  nativeLang: string | null | undefined
  targetLang: string | null | undefined
  level?: string | null
}

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
    `- When the learner asks a question or writes in ${native}, that whole reply is in ${native} and nothing else: explain the point in one or two short sentences and add no ${target}, not even a sentence to keep the conversation going.`,
    '',
    'Because the reply is spoken:',
    '- Write plain sentences only: no markdown, lists, emoji, brackets or stage directions.',
    '- Do not add readings or romanization after a word.',
    bullet(characterRule(learner.targetLang)),
  )
}

export function judgeSystem(learner: Learner, prefs: ScriptPrefs = {}): string {
  return lines(
    'You grade one answer from a language learner. Return only the JSON the schema asks for.',
    `- ${NATIVE_FEEDBACK_RULE(learner.nativeLang, learner.targetLang)}`,
    '- Feedback is one or two short sentences spoken to the learner as "you": kind, specific, no markdown.',
    '- Grade what the task asks about and nothing else.',
    bullet(scriptRule(learner.targetLang, prefs)),
  )
}

/** The last line of a grading request: the language rule and the deck's script rule, restated. */
export const JUDGE_REMINDER = (
  nativeLang: string | null | undefined,
  targetLang: string | null | undefined,
  prefs: ScriptPrefs = {},
): string =>
  [NATIVE_FEEDBACK_REMINDER(nativeLang, targetLang), characterRule(targetLang, prefs)]
    .filter((part) => part !== '')
    .join(' ')

const ROLE_TASK: Record<Exclude<Role, 'conversation'>, string> = {
  judge: 'You grade a language learner. Be precise and kind, and return only what is asked for.',
  generator:
    'You write practice material for a language learner: accurate, natural, and no harder than the request asks.',
  translator:
    'You translate for a language learner: give the natural meaning of the whole phrase, briefly.',
}

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

function lines(...parts: (string | false | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === 'string').join('\n')
}
