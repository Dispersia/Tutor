import type { FreqWord, Pos } from '../../text/lexicon'

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

const FOOD = ['水', '茶', '米飯', '菜', '水果', '蘋果']
const ITEMS = ['書', '電腦', '電話', '車', '錢', '手機', '電視', '衣服', '貓', '狗']
const PEOPLE = [...PERSON_NOUNS]
const THING_SUBJECTS = [...FOOD, ...ITEMS, '中國', '家', '學校', '醫院', '商店', '飯館']

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

const ACTION_VERBS = ['吃', '喝', '看', '讀', '寫', '買', '用', '找', '做']

const PERSON_ADJ = ['好', '忙', '累', '高興', '漂亮', '高']
const THING_ADJ = ['大', '小', '熱', '冷', '新', '舊', '貴', '便宜']
const STRONG_ADJ = ['忙', '累', '高興', '漂亮']
const THING_ADJ_NOUNS = [...THING_SUBJECTS]

export interface Slot {
  pos: Pos[]
  role: string
  prefer?: string[]
  only?: string[]
  nounClass?: NounClass
  objectVerb?: boolean
  objectOf?: string
  exclude?: string[]
}

export interface Pattern {
  parts: Array<string | Slot>
  featureRoles?: Array<{ role: string; pos: Pos[] }>
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
  {
    parts: [subj(), vrb(), obj()],
    featureRoles: [{ role: 'v', pos: ['vt'] }],
    english: (v) => `${gloss(v.s!)} ${verb(v.v!)} ${gloss(v.o!)}`,
  },
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
  {
    parts: [{ pos: ['time'], role: 't', prefer: ['今天'] }, subj(), vrb(), obj()],
    featureRoles: [
      { role: 't', pos: ['time'] },
      { role: 'v', pos: ['vt'] },
    ],
    english: (v) => `${gloss(v.t!)}, ${gloss(v.s!)} ${verb(v.v!)} ${gloss(v.o!)}`,
  },
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
