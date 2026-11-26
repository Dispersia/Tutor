import { langName, scriptRule } from '../llm/prompts'
import type { CharacterVariant } from '../frequency/source'

export interface PlanRequest {
  instruction: string
  targetLang: string
  sourceLang: string
  topic?: string
  words: string[]
  knownWords: string[]
  variant?: CharacterVariant
  readingScript?: string
  count: number
  pitchAccent?: boolean
  reinforce?: boolean
  hints?: Record<string, { reading?: string; meaning?: string }>
}

export interface ChatCardRequest {
  learnerText: string
  replyText: string
  languages: { code: string; name: string }[]
  defaultLang: string
  knownWords: Record<string, string[]>
  variant?: CharacterVariant
  readingScript?: string
  pitchAccent?: boolean
}

export const PLAN_SYSTEM = `You write the cards for one batch of a language-learning deck. Return only the JSON the schema asks for.

You are given the learner's instruction, the batch's new words in order, and the words the learner already knows. The instruction decides the focus: its topic, its register, and whether it wants grammar.

The deck is strictly n+1. The learner meets one new word at a time, and a sentence or grammar prompt may use only words already met: the known words, plus the batch's words that already have their own card earlier in your list. So put the vocab card of a word before any sentence or grammar card that uses it. Before you write a sentence or a prompt, check every word in it against that rule; if any word is not met yet, rewrite the card with words that are met, or leave the card out.

The three kinds of card:

"vocab" — one per new word that names something, in the order given.
- front: the word's meaning in the learner's language, the sense people use in everyday speech, not a dictionary list. Separate several senses with " / ".
- back: the word itself. reading: its reading.
- A word that is itself a grammar point — a particle, copula, conjunction, auxiliary, classifier or another function word whose job is grammar rather than naming something — does not get a vocab card. Give it its grammar card instead, with back the word itself, set payload.intro to true on that card, and never write both a vocab card and a grammar card for the same word.

"sentence" — one for every vocab card, a short sentence (2 to 6 words) a native speaker would really say, that uses the word just introduced.
- back: the sentence. reading: its reading.
- front and payload.gloss: one natural translation of the whole sentence, identical in both fields.
- payload.tokens: the sentence split into its words, in order, the way the language's speakers would. Joined together they equal back.
- payload.distractors: 2 or 3 known words that could fit the sentence but do not belong in it. They must be words the learner has already met; leave the field out rather than invent a word.
- Every sentence carries tokens and distractors, so the app can offer build-the-sentence and pick-the-answer drills.
- If the words met so far cannot make a natural sentence, leave the card out. A missing sentence costs nothing; an odd one ("My you.", "We are him.", "I am me.") teaches something wrong.

"grammar" — one fill-in-the-blank on one grammar point. Write one for every new word that is itself a grammar point, and write more when the instruction asks for grammar, using only words already met. A grammar-point word's card is the introduction of that word: set payload.intro to true on it and give its front and explanation the same care a vocab card gets. Never leave payload.explanation off an intro card: a card that arrives without it is thrown away rather than shown. Leave payload.intro out on a pattern card that only practises known words.
- Every grammar card carries payload.prompt, payload.answer and payload.options. A card that only names a rule and has no blank is not a grammar card: write the blank, or give the word a vocab card instead. A grammar-point word the prompt cannot yet show (no noun to attach to, no verb to use) gets its vocab card and no grammar card, and comes back as a grammar card once the words exist.
- payload.prompt: a full target-language sentence with exactly one word replaced by ___ (three underscores, no spaces around them), using only words the learner has met. The text kept around the blank must never already contain the word you blanked. The blank is never the whole sentence: keep words before and after it (我___ is not a sentence, 我___茶。 is).
- payload.answer and back: the one word that fills the blank, and nothing else: never the phrase around it and never the subject the prompt already shows. 我___ takes 有, not 我有.
- payload.options: 2 or 3 candidate words, one of them the answer; each is a single word that could fill the blank, never a whole phrase, and the wrong ones are real words the learner has met.
- payload.rule: a few words naming the point, in the learner's language, and never the word that fills the blank — the drill shows this line as a hint, so it must not give the answer away.
- front: the same name, and name every form the point has, because this is what the learner reads when the card is first introduced: "Topic particle 는 / 은", not "Topic particle".
- payload.explanation: the whole point, in the learner's language, in two to four short sentences that stand on their own: what it means and what it does in the sentence, when each form is used (은 after a consonant, 는 after a vowel), and the mistake a learner usually makes with it. Somebody who reads only this line must be able to use the point; never leave a form, a condition or the answer's job unexplained.

For every card:
- Write the target language correctly: the right characters or kana, the right particles and word order. A sentence that is grammatically wrong is worse than no card.
- A reading is pronunciation, so it must be right; if you are not sure of one, leave the reading out.
- When a grammar point has more than one form, say which form follows a consonant and which follows a vowel, and check that direction before you write: a condition stated the wrong way round teaches the learner the wrong thing.
- A field holds its content and nothing else: no notes, alternatives, brackets or comments about your choices.
- Translate what a sentence means, not its words in order: 我想你。 is "I miss you.", not "I think you."
- Meanings, rules and explanations are in the learner's language. Words, sentences and prompts are in the target language.`

export const CHAT_CARD_SYSTEM = `You turn one exchange from a language-tutoring chat into a single practice card for the learner.

You are given the learner's own message, the tutor's reply, and the languages the learner has a deck for. Return one card that practises what the learner asked about, in a language the learner has a deck for, or an empty list when no card fits.

Return JSON with:
- "targetLang": the code of the language the card practises, one of the deck codes you are given. The learner's question decides it. A question about a language you were not given a deck for, or a message that is not language practice at all, gets an empty cards list and no targetLang.
- "cards": zero or one card, the single most useful one, of the same kinds a deck uses (vocab, sentence, grammar).

Rules:
- One card only. The most useful card for the question beats a richer one.
- Write the target language correctly, in the deck's script.
- A sentence or grammar prompt may use only words the learner already knows, which are listed for each language. With no known words, write a vocab card and no sentence.
- A reading is the correct pronunciation; leave it out when you are unsure.
- A field holds its content and nothing else: no notes, alternatives, brackets or comments.
- Meanings and explanations are in the learner's language; words, sentences and prompts are in the target language.`

export function planPrompt(req: PlanRequest): string {
  return [
    `Instruction: ${req.instruction}`,
    `Target language: ${langName(req.targetLang)}. Learner's language: ${langName(req.sourceLang)}.`,
    req.topic && `Topic: ${req.topic}.`,
    scriptRule(req.targetLang, req),
    motionRule(req),
    '',
    `New words for this batch, in order (${req.words.length}): ${req.words.join(' ')}`,
    knownLine(req),
    hintBlock(req),
    pitchLine(req),
    reinforceLine(req),
    '',
    `Example of the format (${exampleFor(req).about}):`,
    exampleFor(req).json,
  ]
    .filter((line): line is string => typeof line === 'string')
    .join('\n')
}

function motionRule(req: PlanRequest): string | undefined {
  if (req.targetLang !== 'zh' && req.targetLang !== 'yue') return undefined
  return (
    'In Chinese, 這 and 那 mean "this" and "that", never "here" and "there": a verb of motion ' +
    '(來, 去) must be followed by a place, as in 來這裡 or 去學校, so never write 來這 or 去那. ' +
    'Leave the sentence card out when no place word is known yet.'
  )
}

function knownLine(req: PlanRequest): string {
  if (!req.knownWords.length) return 'Words already known: none yet.'
  return `Words already known (use freely, never as a new vocab card): ${req.knownWords.join(' ')}`
}

function hintBlock(req: PlanRequest): string | undefined {
  const batch = new Set(req.words)
  const hints = Object.entries(req.hints ?? {})
    .filter(([w]) => batch.has(w))
    .map(
      ([w, h]) =>
        `- ${w}${h.reading ? ` [${h.reading}]` : ''}${h.meaning ? ` = ${h.meaning}` : ''}`,
    )
  if (!hints.length) return undefined
  return `\nThe learner's own notes for these words (reading / meaning). Prefer them unless they are plainly wrong:\n${hints.join('\n')}`
}

function pitchLine(req: PlanRequest): string | undefined {
  if (!req.pitchAccent) return undefined
  return `\nAdd pitch accent to each vocab card you are sure of, as metadata.pitch: "syllables" (the word split into moras), "levels" (one "H" or "L" per mora) and "drop" (the mora after which the pitch falls, counted from 1; 0 when it never falls). Leave metadata out when unsure.`
}

function reinforceLine(req: PlanRequest): string | undefined {
  if (!req.reinforce) return undefined
  return `\nThe learner keeps forgetting ${req.words.join(' ')}. After its vocab card, write one sentence card and one grammar card that practise it with known words only.`
}

export function chatCardPrompt(req: ChatCardRequest): string {
  return [
    `Learner's message: ${req.learnerText.trim()}`,
    `Tutor's reply: ${req.replyText.trim()}`,
    `Languages the learner has a deck for: ${deckLine(req.languages)}`,
    `Language of the exchange: ${langName(req.defaultLang)}. Use it when the learner's message does not make the language clear.`,
    scriptRule(req.defaultLang, req),
    '',
    knownBlock(req),
  ]
    .filter((line): line is string => typeof line === 'string')
    .join('\n')
}

function deckLine(languages: { code: string; name: string }[]): string {
  return languages.map((l) => `${l.name} (${l.code})`).join(', ')
}

function knownBlock(req: ChatCardRequest): string {
  const lines = req.languages.map((l) => {
    const words = req.knownWords[l.code] ?? []
    return `${langName(l.code)}: ${words.length ? words.join(' ') : 'none yet'}`
  })
  return `Words the learner already knows, by language:\n${lines.join('\n')}`
}

interface Example {
  about: string
  json: string
}

function exampleFor(req: PlanRequest): Example {
  if (req.targetLang === 'zh' || req.targetLang === 'yue') return chineseExample(req)
  if (req.targetLang === 'ja') return JAPANESE_EXAMPLE
  if (req.targetLang === 'ko') return KOREAN_EXAMPLE
  return GENERIC_EXAMPLE
}

function chineseExample(req: PlanRequest): Example {
  const pinyin = req.readingScript === 'pinyin'
  const r = pinyin
    ? ['hē', 'wǒ hē', 'chá', 'wǒ hē chá']
    : ['ㄏㄜ', 'ㄨㄛˇ ㄏㄜ', 'ㄔㄚˊ', 'ㄨㄛˇ ㄏㄜ ㄔㄚˊ']
  return {
    about: 'known: 我 你 是 — new: 喝 茶 — the instruction asked for grammar',
    json: JSON.stringify({
      cards: [
        { template: 'vocab', front: 'to drink', back: '喝', reading: r[0] },
        { ...SENTENCE_ZH_DRINK, reading: r[1] },
        { template: 'vocab', front: 'tea', back: '茶', reading: r[2] },
        { ...SENTENCE_ZH, reading: r[3] },
        GRAMMAR_ZH,
      ],
    }),
  }
}

const SENTENCE_ZH_DRINK = {
  template: 'sentence',
  front: 'I drink.',
  back: '我喝。',
  payload: { tokens: ['我', '喝'], gloss: 'I drink.', distractors: ['你', '是'] },
}

const SENTENCE_ZH = {
  template: 'sentence',
  front: 'I drink tea.',
  back: '我喝茶。',
  payload: { tokens: ['我', '喝', '茶'], gloss: 'I drink tea.', distractors: ['你', '是'] },
}

const GRAMMAR_ZH = {
  template: 'grammar',
  front: 'verb before object',
  back: '喝',
  payload: {
    prompt: '我___茶。',
    answer: '喝',
    options: ['喝', '茶'],
    rule: 'verb before object',
    explanation:
      'The verb comes before the thing it acts on, so 喝茶 is "drink tea". Chinese verbs never change their ending, so word order alone says who does what.',
  },
}

const JAPANESE_EXAMPLE: Example = {
  about: 'known: 私 あなた 人 です — new: は — the instruction asked for grammar',
  json: JSON.stringify({
    cards: [
      {
        template: 'grammar',
        front: 'Topic particle: は / が',
        back: 'は',
        payload: {
          prompt: '私___人です。',
          answer: 'は',
          options: ['は', 'が'],
          rule: 'topic particle',
          intro: true,
          explanation:
            'は marks what the sentence is about; it is written は but said as わ. Use は to say something about a topic you have already raised (私は人です, "as for me, I am a person") and が to point out who or what does it (私が人です, "it is I who is the person"). The other choice here, を, is not a topic marker at all: it marks the object of a verb.',
        },
      },
      {
        template: 'sentence',
        front: 'I am a person.',
        back: '私は人です。',
        reading: 'わたしはひとです',
        payload: {
          tokens: ['私', 'は', '人', 'です'],
          gloss: 'I am a person.',
          distractors: ['あなた'],
        },
      },
    ],
  }),
}

const KOREAN_EXAMPLE: Example = {
  about: 'known: 저 학생 이에요 — new: 는 — the instruction asked for grammar',
  json: JSON.stringify({
    cards: [
      {
        template: 'grammar',
        front: 'Topic particle: 는 / 은',
        back: '는',
        payload: {
          prompt: '저___ 학생이에요.',
          answer: '는',
          options: ['는', '은'],
          rule: 'topic particle',
          intro: true,
          explanation:
            'These two forms mark the topic — what the sentence is about — and mean the same thing; you choose by the last sound of the word in front of it. Use 은 after a consonant (학생 ends in a consonant, so 학생은) and 는 after a vowel (저 ends in a vowel, so 저는). The common mistake is using the subject markers 이 / 가 instead, which point out who does the action rather than what the sentence is about.',
        },
      },
      {
        template: 'sentence',
        front: 'I am a student.',
        back: '저는 학생이에요.',
        payload: {
          tokens: ['저', '는', '학생', '이에요'],
          gloss: 'I am a student.',
          distractors: ['사람'],
        },
      },
    ],
  }),
}

const GENERIC_EXAMPLE: Example = {
  about: 'Spanish for an English speaker; known: yo no — new: bebo agua',
  json: JSON.stringify({
    cards: [
      { template: 'vocab', front: 'I drink', back: 'bebo' },
      { template: 'vocab', front: 'water', back: 'agua' },
      {
        template: 'sentence',
        front: 'I drink water.',
        back: 'Bebo agua.',
        payload: { tokens: ['Bebo', 'agua'], gloss: 'I drink water.', distractors: ['yo', 'no'] },
      },
    ],
  }),
}
