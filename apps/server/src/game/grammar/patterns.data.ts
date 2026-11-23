/**
 * The hand-written Mandarin pattern grammar — data only (docs/DESIGN.md §13.7).
 *
 * `PATTERNS` is the list of sentence shapes the builder tries, in order. The
 * semantic sets (which noun is a person, which verb takes which object) are what
 * keep the generated sentences from being nonsense like "I drink computer".
 * `build.ts` is the engine that fills these slots; a content edit lives here.
 */

import type { FreqWord, Pos } from '../../seed/frequency'

export type NounClass = 'person' | 'place' | 'thing'

const PERSON_NOUNS = new Set([
  '人',
  '老師',
  '學生',
  '朋友',
  '媽媽',
  '爸爸',
  '兒子',
  '女兒',
  '哥哥',
  '姐姐',
])
const PLACE_NOUNS = new Set(['中國', '家', '醫院', '學校', '商店', '飯館'])
const COUNTRY_NOUNS = new Set(['中國'])

export function nounClass(word: string): NounClass {
  if (PERSON_NOUNS.has(word)) return 'person'
  if (PLACE_NOUNS.has(word)) return 'place'
  return 'thing'
}

const placeClause = (w: FreqWord): string =>
  COUNTRY_NOUNS.has(w.word) ? `in ${gloss(w)}` : `at the ${gloss(w)}`

// --- semantic classes ---------------------------------------------------------

const FOOD = ['水', '茶', '米飯', '菜', '水果', '蘋果']
const ITEMS = ['書', '電腦', '電話', '車', '錢', '手機', '電視', '衣服', '貓', '狗']
const PEOPLE = [...PERSON_NOUNS]
const THING_SUBJECTS = [...FOOD, ...ITEMS, '中國', '家', '學校', '醫院', '商店', '飯館']

/** What each transitive verb can reasonably take as its object. */
export const VERB_OBJECTS: Record<string, string[]> = {
  吃: ['米飯', '菜', '水果', '蘋果'],
  喝: ['水', '茶'],
  看: ['書', '電視', '電腦', '貓', '狗', '人'],
  說: ['漢語', '名字'],
  讀: ['書'],
  寫: ['名字'],
  買: [...ITEMS, ...FOOD],
  愛: [...FOOD, ...PEOPLE, ...ITEMS, '中國'],
  喜歡: [...FOOD, ...PEOPLE, ...ITEMS, '中國'],
  學習: ['漢語'],
  知道: ['名字'],
  用: ['電腦', '電話', '手機'],
  找: [...ITEMS, ...PEOPLE, ...FOOD],
  幫助: PEOPLE,
  開始: ['工作'],
  做: ['米飯', '菜', '工作'],
}

export const OBJECT_VERBS = new Set(Object.keys(VERB_OBJECTS))

/** Action verbs that read naturally after a modal (我會寫). */
const ACTION_VERBS = ['吃', '喝', '看', '讀', '寫', '買', '用', '找', '做']

/** Adjectives that read naturally with a person as the subject (我很忙). */
const PERSON_ADJ = ['好', '忙', '累', '高興', '漂亮', '高']
/** Adjectives that describe a thing (茶很熱). */
const THING_ADJ = ['大', '小', '熱', '冷', '新', '舊', '貴', '便宜']
/** Intensifiers read best with these. */
const STRONG_ADJ = ['忙', '累', '高興', '漂亮']
/** Nouns that work with 很 + THING_ADJ. */
const THING_ADJ_NOUNS = [...THING_SUBJECTS]

export interface Slot {
  pos: Pos[]
  role: string
  /** prefer these words when filling the slot (still must be known) */
  prefer?: string[]
  /** restrict the slot to these words only */
  only?: string[]
  /** restrict a noun slot to a semantic class */
  nounClass?: NounClass
  /** restrict a vt slot to the transitive verbs that take a simple object */
  objectVerb?: boolean
  /** this slot's object must be compatible with the verb in another role */
  objectOf?: string
  /** forbid these words in the slot */
  exclude?: string[]
}

export interface Pattern {
  /** literal Chinese words and fillable slots, in order */
  parts: Array<string | Slot>
  /** the new word may fill one of these roles */
  featureRoles?: Array<{ role: string; pos: Pos[] }>
  /** the new word may be one of these literal words */
  featureLiterals?: string[]
  english: (v: Record<string, FreqWord>) => string
}

const gloss = (w: FreqWord): string => w.en.split(',')[0]!.trim()
const verb = (w: FreqWord): string => w.en.replace(/^to /, '').split(',')[0]!.trim()
const article = (word: string): string => (/^[aeiou]/i.test(word) ? 'an' : 'a')

const BE: Record<string, string> = {
  我: 'am',
  你: 'are',
  他: 'is',
  她: 'is',
  我們: 'are',
  這: 'is',
  那: 'is',
}
const beFor = (w: FreqWord): string => BE[w.word] ?? 'is'

const HAVE: Record<string, string> = { 我: 'have', 我們: 'have', 你: 'have' }
const haveFor = (w: FreqWord): string => HAVE[w.word] ?? 'has'

const WANT: Record<string, string> = { 想: 'want to', 要: 'want to', 會: 'can', 能: 'can' }
const wantFor = (w: FreqWord): string => WANT[w.word] ?? 'want to'

const DO_SUBJECT: Record<string, string> = {
  我: 'do I',
  你: 'do you',
  我們: 'do we',
  他: 'does he',
  她: 'does she',
}

const POSSESSIVE: Record<string, string> = {
  我: 'my',
  你: 'your',
  他: 'his',
  她: 'her',
  我們: 'our',
  這: 'this',
  那: 'that',
}
const possessive = (w: FreqWord): string => POSSESSIVE[w.word] ?? gloss(w)

const subj = (o: Partial<Slot> = {}): Slot => ({ pos: ['pron'], role: 's', prefer: ['我'], ...o })
const vrb = (o: Partial<Slot> = {}): Slot => ({
  pos: ['vt'],
  role: 'v',
  objectVerb: true,
  ...o,
})
const obj = (o: Partial<Slot> = {}): Slot => ({ pos: ['noun'], role: 'o', objectOf: 'v', ...o })

export const PATTERNS: Pattern[] = [
  // Subject + verb + object:  我喝茶
  {
    parts: [subj(), vrb(), obj()],
    featureRoles: [{ role: 'v', pos: ['vt'] }],
    english: (v) => `${gloss(v.s!)} ${verb(v.v!)} ${gloss(v.o!)}`,
  },
  // Identity with 是:  我是學生
  {
    parts: [
      { pos: ['pron'], role: 's', prefer: ['我'] },
      '是',
      { pos: ['noun'], role: 'o', nounClass: 'person' },
    ],
    featureRoles: [
      { role: 'o', pos: ['noun'] },
      { role: 's', pos: ['pron'] },
    ],
    english: (v) => `${gloss(v.s!)} ${beFor(v.s!)} ${article(gloss(v.o!))} ${gloss(v.o!)}`,
  },
  // Possession 有:  我有茶
  {
    parts: [
      { pos: ['pron'], role: 's', prefer: ['我'] },
      '有',
      { pos: ['noun'], role: 'o', only: [...FOOD, ...ITEMS] },
    ],
    featureRoles: [
      { role: 'o', pos: ['noun'] },
      { role: 's', pos: ['pron'] },
    ],
    english: (v) => `${gloss(v.s!)} ${haveFor(v.s!)} ${gloss(v.o!)}`,
  },
  // Location 在:  我在學校
  {
    parts: [
      { pos: ['pron'], role: 's', prefer: ['我'] },
      '在',
      { pos: ['noun'], role: 'p', nounClass: 'place' },
    ],
    featureRoles: [
      { role: 'p', pos: ['noun'] },
      { role: 's', pos: ['pron'] },
    ],
    english: (v) => `${gloss(v.s!)} ${beFor(v.s!)} ${placeClause(v.p!)}`,
  },
  // Pronoun + 很 + adjective (person):  我很好
  {
    parts: [
      { pos: ['pron'], role: 's', prefer: ['我'] },
      '很',
      { pos: ['vadj'], role: 'a', only: PERSON_ADJ },
    ],
    featureRoles: [
      { role: 'a', pos: ['vadj'] },
      { role: 's', pos: ['pron'] },
    ],
    featureLiterals: ['很'],
    english: (v) => `${gloss(v.s!)} ${beFor(v.s!)} very ${gloss(v.a!)}`,
  },
  // Noun + 很 + adjective (thing):  茶很熱
  {
    parts: [
      { pos: ['noun'], role: 'n', only: THING_ADJ_NOUNS, prefer: ['茶'] },
      '很',
      { pos: ['vadj'], role: 'a', only: THING_ADJ },
    ],
    featureRoles: [
      { role: 'a', pos: ['vadj'] },
      { role: 'n', pos: ['noun'] },
    ],
    english: (v) => `${gloss(v.n!)} ${beFor(v.n!)} very ${gloss(v.a!)}`,
  },
  // Subject + intransitive verb:  我睡覺
  {
    parts: [
      { pos: ['pron'], role: 's', prefer: ['我'] },
      { pos: ['vi'], role: 'v', exclude: ['去', '來'] },
    ],
    featureRoles: [
      { role: 'v', pos: ['vi'] },
      { role: 's', pos: ['pron'] },
    ],
    english: (v) => `${gloss(v.s!)} ${verb(v.v!)}`,
  },
  // Time + subject + verb + object:  今天我喝茶
  {
    parts: [{ pos: ['time'], role: 't', prefer: ['今天'] }, subj(), vrb(), obj()],
    featureRoles: [
      { role: 't', pos: ['time'] },
      { role: 'v', pos: ['vt'] },
    ],
    english: (v) => `${gloss(v.t!)}, ${gloss(v.s!)} ${verb(v.v!)} ${gloss(v.o!)}`,
  },
  // Subject + modal + verb + object:  我想喝茶
  {
    parts: [
      { pos: ['pron'], role: 's', prefer: ['我'] },
      { pos: ['aux'], role: 'm', prefer: ['想'] },
      { pos: ['vt'], role: 'v', objectVerb: true, only: ACTION_VERBS },
      { pos: ['noun'], role: 'o', objectOf: 'v' },
    ],
    featureRoles: [
      { role: 'v', pos: ['vt'] },
      { role: 'm', pos: ['aux'] },
    ],
    english: (v) => `${gloss(v.s!)} ${wantFor(v.m!)} ${verb(v.v!)} ${gloss(v.o!)}`,
  },
  // Negation 不:  我不喝茶
  {
    parts: [
      { pos: ['pron'], role: 's', prefer: ['我'] },
      '不',
      { pos: ['vt'], role: 'v', objectVerb: true },
      { pos: ['noun'], role: 'o', objectOf: 'v' },
    ],
    featureRoles: [{ role: 'v', pos: ['vt'] }],
    featureLiterals: ['不'],
    english: (v) => `${gloss(v.s!)} do not ${verb(v.v!)} ${gloss(v.o!)}`,
  },
  // Yes/no question 嗎:  你喝茶嗎
  {
    parts: [
      { pos: ['pron'], role: 's', prefer: ['你'] },
      { pos: ['vt'], role: 'v', objectVerb: true },
      { pos: ['noun'], role: 'o', objectOf: 'v' },
      '嗎',
    ],
    featureRoles: [
      { role: 'v', pos: ['vt'] },
      { role: 'o', pos: ['noun'] },
    ],
    featureLiterals: ['嗎'],
    english: (v) =>
      `${DO_SUBJECT[v.s!.word] ?? `does ${gloss(v.s!)}`} ${verb(v.v!)} ${gloss(v.o!)}?`,
  },
  // Adverb 也:  我也喝茶
  {
    parts: [
      { pos: ['pron'], role: 's', prefer: ['我們'] },
      { pos: ['adv'], role: 'd', only: ['也'] },
      { pos: ['vt'], role: 'v', objectVerb: true },
      { pos: ['noun'], role: 'o', objectOf: 'v' },
    ],
    featureRoles: [{ role: 'd', pos: ['adv'] }],
    english: (v) => `${gloss(v.s!)} also ${verb(v.v!)} ${gloss(v.o!)}`,
  },
  // Intensifier 太 / 非常:  我太累了
  {
    parts: [
      { pos: ['pron'], role: 's', prefer: ['我'] },
      { pos: ['adv'], role: 'd', only: ['太', '非常'] },
      { pos: ['vadj'], role: 'a', only: STRONG_ADJ },
    ],
    featureRoles: [
      { role: 'd', pos: ['adv'] },
      { role: 'a', pos: ['vadj'] },
    ],
    english: (v) =>
      `${gloss(v.s!)} ${beFor(v.s!)} ${v.d!.word === '太' ? 'too' : 'very'} ${gloss(v.a!)}`,
  },
  // Possessive 的:  我的書
  {
    parts: [
      { pos: ['pron'], role: 's', prefer: ['我'] },
      '的',
      {
        pos: ['noun'],
        role: 'o',
        only: [...FOOD, ...ITEMS, ...PEOPLE, '家', '名字', '工作', '時間'],
      },
    ],
    featureRoles: [{ role: 'o', pos: ['noun'] }],
    featureLiterals: ['的'],
    english: (v) => `${possessive(v.s!)} ${gloss(v.o!)}`,
  },
  // Conjunction 和:  茶和書
  {
    parts: [
      { pos: ['noun'], role: 'a', only: [...FOOD, ...ITEMS], prefer: ['茶'] },
      '和',
      { pos: ['noun'], role: 'b', only: [...FOOD, ...ITEMS] },
    ],
    featureRoles: [
      { role: 'a', pos: ['noun'] },
      { role: 'b', pos: ['noun'] },
    ],
    featureLiterals: ['和'],
    english: (v) => `${gloss(v.a!)} and ${gloss(v.b!)}`,
  },
]
