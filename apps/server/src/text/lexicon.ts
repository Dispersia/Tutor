/**
 * The Mandarin lexicon: a frequency list (docs/DESIGN.md §13.7). It lives in
 * `text/` because the grammar engine and the sentence drills read it at runtime;
 * `seed/service.ts` also seeds the test-fixture deck from it.
 *
 * Ordered roughly by frequency, then trimmed for beginner usefulness: the head
 * of the list is the words you can actually build sentences with, so the path
 * can introduce grammar words (是, 不, 我 …) early and start combining them into
 * sentences almost immediately. Each entry carries the part of speech the
 * grammar engine (`game/grammar.ts`) needs to slot it into a pattern.
 *
 * This is the "spine" of the frequency curriculum: the deck is seeded in this
 * order and the path walks it one word at a time (strict n+1).
 */

export type Pos =
  | 'pron' // pronoun (我, 你, 他 …)
  | 'noun'
  | 'vt' // transitive verb (吃, 喝, 看 …)
  | 'vi' // intransitive verb (睡覺, 走, 來 …)
  | 'vadj' // stative verb / adjective (好, 大, 忙 …)
  | 'aux' // modal / auxiliary (想, 要, 會, 能)
  | 'adv' // adverb (很, 也, 都, 不, 太)
  | 'num'
  | 'measure'
  | 'time'
  | 'part' // particle (的, 了, 嗎)
  | 'qword' // question word (什麼, 誰 …)
  | 'conj' // conjunction (和)
  | 'prep' // preposition (在)
  | 'greet' // set greeting (你好 …)

export interface FreqWord {
  /** target text (hanzi) */
  word: string
  /** pinyin (space separated) */
  pinyin: string
  /** short English gloss used in prompts */
  en: string
  /** part of speech */
  pos: Pos
}

/** Ordered by frequency: the head doubles as the first lesson sequence. */
export const FREQUENCY: FreqWord[] = [
  { word: '我', pinyin: 'wǒ', en: 'I, me', pos: 'pron' },
  { word: '你', pinyin: 'nǐ', en: 'you', pos: 'pron' },
  { word: '是', pinyin: 'shì', en: 'to be', pos: 'vt' },
  { word: '不', pinyin: 'bù', en: 'not', pos: 'adv' },
  { word: '好', pinyin: 'hǎo', en: 'good', pos: 'vadj' },
  { word: '很', pinyin: 'hěn', en: 'very', pos: 'adv' },
  { word: '的', pinyin: 'de', en: 'possessive particle', pos: 'part' },
  { word: '他', pinyin: 'tā', en: 'he, him', pos: 'pron' },
  { word: '她', pinyin: 'tā', en: 'she, her', pos: 'pron' },
  { word: '這', pinyin: 'zhè', en: 'this', pos: 'pron' },
  { word: '那', pinyin: 'nà', en: 'that', pos: 'pron' },
  { word: '人', pinyin: 'rén', en: 'person', pos: 'noun' },
  { word: '嗎', pinyin: 'ma', en: 'question particle', pos: 'part' },
  { word: '我們', pinyin: 'wǒmen', en: 'we, us', pos: 'pron' },
  { word: '有', pinyin: 'yǒu', en: 'to have', pos: 'vt' },
  { word: '一', pinyin: 'yī', en: 'one', pos: 'num' },
  { word: '個', pinyin: 'gè', en: 'measure word', pos: 'measure' },
  { word: '名字', pinyin: 'míngzi', en: 'name', pos: 'noun' },
  { word: '叫', pinyin: 'jiào', en: 'to be called', pos: 'vt' },
  { word: '什麼', pinyin: 'shénme', en: 'what', pos: 'qword' },
  { word: '中國', pinyin: 'Zhōngguó', en: 'China', pos: 'noun' },
  { word: '漢語', pinyin: 'Hànyǔ', en: 'Chinese language', pos: 'noun' },
  { word: '老師', pinyin: 'lǎoshī', en: 'teacher', pos: 'noun' },
  { word: '學生', pinyin: 'xuésheng', en: 'student', pos: 'noun' },
  { word: '朋友', pinyin: 'péngyou', en: 'friend', pos: 'noun' },
  { word: '家', pinyin: 'jiā', en: 'home, family', pos: 'noun' },
  { word: '水', pinyin: 'shuǐ', en: 'water', pos: 'noun' },
  { word: '茶', pinyin: 'chá', en: 'tea', pos: 'noun' },
  { word: '米飯', pinyin: 'mǐfàn', en: 'rice', pos: 'noun' },
  { word: '吃', pinyin: 'chī', en: 'to eat', pos: 'vt' },
  { word: '喝', pinyin: 'hē', en: 'to drink', pos: 'vt' },
  { word: '看', pinyin: 'kàn', en: 'to look at', pos: 'vt' },
  { word: '聽', pinyin: 'tīng', en: 'to listen to', pos: 'vt' },
  { word: '說', pinyin: 'shuō', en: 'to speak', pos: 'vt' },
  { word: '讀', pinyin: 'dú', en: 'to read', pos: 'vt' },
  { word: '寫', pinyin: 'xiě', en: 'to write', pos: 'vt' },
  { word: '買', pinyin: 'mǎi', en: 'to buy', pos: 'vt' },
  { word: '今天', pinyin: 'jīntiān', en: 'today', pos: 'time' },
  { word: '明天', pinyin: 'míngtiān', en: 'tomorrow', pos: 'time' },
  { word: '昨天', pinyin: 'zuótiān', en: 'yesterday', pos: 'time' },
  { word: '現在', pinyin: 'xiànzài', en: 'now', pos: 'time' },
  { word: '早上', pinyin: 'zǎoshang', en: 'morning', pos: 'time' },
  { word: '二', pinyin: 'èr', en: 'two', pos: 'num' },
  { word: '三', pinyin: 'sān', en: 'three', pos: 'num' },
  { word: '十', pinyin: 'shí', en: 'ten', pos: 'num' },
  { word: '書', pinyin: 'shū', en: 'book', pos: 'noun' },
  { word: '電腦', pinyin: 'diànnǎo', en: 'computer', pos: 'noun' },
  { word: '電話', pinyin: 'diànhuà', en: 'telephone', pos: 'noun' },
  { word: '車', pinyin: 'chē', en: 'car', pos: 'noun' },
  { word: '錢', pinyin: 'qián', en: 'money', pos: 'noun' },
  { word: '小', pinyin: 'xiǎo', en: 'small', pos: 'vadj' },
  { word: '大', pinyin: 'dà', en: 'big', pos: 'vadj' },
  { word: '熱', pinyin: 'rè', en: 'hot', pos: 'vadj' },
  { word: '冷', pinyin: 'lěng', en: 'cold', pos: 'vadj' },
  { word: '愛', pinyin: 'ài', en: 'to love', pos: 'vt' },
  { word: '喜歡', pinyin: 'xǐhuan', en: 'to like', pos: 'vt' },
  { word: '工作', pinyin: 'gōngzuò', en: 'work', pos: 'noun' },
  { word: '學習', pinyin: 'xuéxí', en: 'to study', pos: 'vt' },
  { word: '睡覺', pinyin: 'shuìjiào', en: 'to sleep', pos: 'vi' },
  { word: '想', pinyin: 'xiǎng', en: 'to want', pos: 'aux' },
  { word: '要', pinyin: 'yào', en: 'to want', pos: 'aux' },
  { word: '會', pinyin: 'huì', en: 'can, to know how', pos: 'aux' },
  { word: '能', pinyin: 'néng', en: 'can, to be able', pos: 'aux' },
  { word: '去', pinyin: 'qù', en: 'to go', pos: 'vi' },
  { word: '來', pinyin: 'lái', en: 'to come', pos: 'vi' },
  { word: '做', pinyin: 'zuò', en: 'to make, to do', pos: 'vt' },
  { word: '給', pinyin: 'gěi', en: 'to give', pos: 'vt' },
  { word: '知道', pinyin: 'zhīdào', en: 'to know', pos: 'vt' },
  { word: '覺得', pinyin: 'juéde', en: 'to feel, to think', pos: 'vt' },
  { word: '用', pinyin: 'yòng', en: 'to use', pos: 'vt' },
  { word: '找', pinyin: 'zhǎo', en: 'to look for', pos: 'vt' },
  { word: '送', pinyin: 'sòng', en: 'to give (a gift)', pos: 'vt' },
  { word: '等', pinyin: 'děng', en: 'to wait', pos: 'vt' },
  { word: '幫助', pinyin: 'bāngzhù', en: 'to help', pos: 'vt' },
  { word: '開始', pinyin: 'kāishǐ', en: 'to start', pos: 'vt' },
  { word: '開', pinyin: 'kāi', en: 'to open', pos: 'vt' },
  { word: '關', pinyin: 'guān', en: 'to close', pos: 'vt' },
  { word: '坐', pinyin: 'zuò', en: 'to sit', pos: 'vi' },
  { word: '住', pinyin: 'zhù', en: 'to live', pos: 'vi' },
  { word: '走', pinyin: 'zǒu', en: 'to walk', pos: 'vi' },
  { word: '起床', pinyin: 'qǐchuáng', en: 'to get up', pos: 'vi' },
  { word: '也', pinyin: 'yě', en: 'also, too', pos: 'adv' },
  { word: '都', pinyin: 'dōu', en: 'all, both', pos: 'adv' },
  { word: '太', pinyin: 'tài', en: 'too, overly', pos: 'adv' },
  { word: '非常', pinyin: 'fēicháng', en: 'very, extremely', pos: 'adv' },
  { word: '一起', pinyin: 'yìqǐ', en: 'together', pos: 'adv' },
  { word: '和', pinyin: 'hé', en: 'and, with', pos: 'conj' },
  { word: '誰', pinyin: 'shéi', en: 'who', pos: 'qword' },
  { word: '哪', pinyin: 'nǎ', en: 'which', pos: 'qword' },
  { word: '哪兒', pinyin: 'nǎr', en: 'where', pos: 'qword' },
  { word: '怎麼', pinyin: 'zěnme', en: 'how', pos: 'qword' },
  { word: '為什麼', pinyin: 'wèishénme', en: 'why', pos: 'qword' },
  { word: '多少', pinyin: 'duōshao', en: 'how many', pos: 'qword' },
  { word: '幾', pinyin: 'jǐ', en: 'how many (small)', pos: 'qword' },
  { word: '點', pinyin: 'diǎn', en: "o'clock", pos: 'measure' },
  { word: '分', pinyin: 'fēn', en: 'minute', pos: 'measure' },
  { word: '年', pinyin: 'nián', en: 'year', pos: 'measure' },
  { word: '天', pinyin: 'tiān', en: 'day', pos: 'measure' },
  { word: '月', pinyin: 'yuè', en: 'month', pos: 'noun' },
  { word: '星期', pinyin: 'xīngqī', en: 'week', pos: 'noun' },
  { word: '高', pinyin: 'gāo', en: 'tall, high', pos: 'vadj' },
  { word: '高興', pinyin: 'gāoxìng', en: 'happy', pos: 'vadj' },
  { word: '忙', pinyin: 'máng', en: 'busy', pos: 'vadj' },
  { word: '累', pinyin: 'lèi', en: 'tired', pos: 'vadj' },
  { word: '新', pinyin: 'xīn', en: 'new', pos: 'vadj' },
  { word: '舊', pinyin: 'jiù', en: 'old', pos: 'vadj' },
  { word: '貴', pinyin: 'guì', en: 'expensive', pos: 'vadj' },
  { word: '便宜', pinyin: 'piányi', en: 'cheap', pos: 'vadj' },
  { word: '漂亮', pinyin: 'piàoliang', en: 'pretty', pos: 'vadj' },
  { word: '多', pinyin: 'duō', en: 'many', pos: 'vadj' },
  { word: '少', pinyin: 'shǎo', en: 'few', pos: 'vadj' },
  { word: '對', pinyin: 'duì', en: 'correct', pos: 'vadj' },
  { word: '醫院', pinyin: 'yīyuàn', en: 'hospital', pos: 'noun' },
  { word: '學校', pinyin: 'xuéxiào', en: 'school', pos: 'noun' },
  { word: '商店', pinyin: 'shāngdiàn', en: 'shop', pos: 'noun' },
  { word: '飯館', pinyin: 'fànguǎn', en: 'restaurant', pos: 'noun' },
  { word: '菜', pinyin: 'cài', en: 'dish, food', pos: 'noun' },
  { word: '水果', pinyin: 'shuǐguǒ', en: 'fruit', pos: 'noun' },
  { word: '蘋果', pinyin: 'píngguǒ', en: 'apple', pos: 'noun' },
  { word: '貓', pinyin: 'māo', en: 'cat', pos: 'noun' },
  { word: '狗', pinyin: 'gǒu', en: 'dog', pos: 'noun' },
  { word: '手機', pinyin: 'shǒujī', en: 'mobile phone', pos: 'noun' },
  { word: '電視', pinyin: 'diànshì', en: 'television', pos: 'noun' },
  { word: '衣服', pinyin: 'yīfu', en: 'clothes', pos: 'noun' },
  { word: '天氣', pinyin: 'tiānqì', en: 'weather', pos: 'noun' },
  { word: '時候', pinyin: 'shíhou', en: 'time, moment', pos: 'noun' },
  { word: '時間', pinyin: 'shíjiān', en: 'time', pos: 'noun' },
  { word: '媽媽', pinyin: 'māma', en: 'mother', pos: 'noun' },
  { word: '爸爸', pinyin: 'bàba', en: 'father', pos: 'noun' },
  { word: '兒子', pinyin: 'érzi', en: 'son', pos: 'noun' },
  { word: '女兒', pinyin: "nǚ'ér", en: 'daughter', pos: 'noun' },
  { word: '哥哥', pinyin: 'gēge', en: 'older brother', pos: 'noun' },
  { word: '姐姐', pinyin: 'jiějie', en: 'older sister', pos: 'noun' },
  { word: '在', pinyin: 'zài', en: 'at, to be in', pos: 'prep' },
  { word: '了', pinyin: 'le', en: 'completed-action particle', pos: 'part' },
  { word: '謝謝', pinyin: 'xièxie', en: 'to thank', pos: 'vt' },
  { word: '你好', pinyin: 'nǐ hǎo', en: 'hello', pos: 'greet' },
  { word: '再見', pinyin: 'zàijiàn', en: 'goodbye', pos: 'greet' },
]

/** word -> entry, for the grammar engine and support checks. */
export const LEXICON: Map<string, FreqWord> = new Map(FREQUENCY.map((w) => [w.word, w]))
