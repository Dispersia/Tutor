/**
 * A Japanese frequency list, the Japanese counterpart to `text/lexicon.ts`
 * (docs/DESIGN.md §13.7).
 *
 * Ordered roughly by usefulness so the head is the words a beginner can build
 * with. The deck is seeded in this order and the path walks it one word per
 * step (strict n+1), exactly like Mandarin. `kana` is the native reading shown
 * as furigana; `romaji` is only used to derive it and is never displayed.
 */

export type JaPos =
  | 'pron' // pronoun / demonstrative (私, これ …)
  | 'noun'
  | 'verb'
  | 'adj' // い-adjective (大きい …)
  | 'nadj' // な-adjective (好き …)
  | 'adv'
  | 'part' // particle (は, を, に …)
  | 'qword' // question word (何, 誰 …)
  | 'num'
  | 'copula' // です
  | 'conj'

export interface JaFreqWord {
  /** display form (kanji + kana) */
  word: string
  /** hiragana reading (furigana source) */
  kana: string
  /** latin transliteration — used only to derive the native reading */
  romaji: string
  /** short English gloss used in prompts */
  en: string
  pos: JaPos
}

export const FREQUENCY_JA: JaFreqWord[] = [
  // people & pronouns
  { word: '私', kana: 'わたし', romaji: 'watashi', en: 'I, me', pos: 'pron' },
  { word: 'あなた', kana: 'あなた', romaji: 'anata', en: 'you', pos: 'pron' },
  { word: '彼', kana: 'かれ', romaji: 'kare', en: 'he, him', pos: 'pron' },
  { word: '彼女', kana: 'かのじょ', romaji: 'kanojo', en: 'she, her', pos: 'pron' },
  { word: '人', kana: 'ひと', romaji: 'hito', en: 'person', pos: 'noun' },
  { word: '友達', kana: 'ともだち', romaji: 'tomodachi', en: 'friend', pos: 'noun' },
  { word: '先生', kana: 'せんせい', romaji: 'sensei', en: 'teacher', pos: 'noun' },
  { word: '学生', kana: 'がくせい', romaji: 'gakusei', en: 'student', pos: 'noun' },
  { word: '家族', kana: 'かぞく', romaji: 'kazoku', en: 'family', pos: 'noun' },

  // demonstratives & question words
  { word: 'これ', kana: 'これ', romaji: 'kore', en: 'this', pos: 'pron' },
  { word: 'それ', kana: 'それ', romaji: 'sore', en: 'that', pos: 'pron' },
  { word: 'あれ', kana: 'あれ', romaji: 'are', en: 'that (over there)', pos: 'pron' },
  { word: 'ここ', kana: 'ここ', romaji: 'koko', en: 'here', pos: 'pron' },
  { word: 'そこ', kana: 'そこ', romaji: 'soko', en: 'there', pos: 'pron' },
  { word: 'どこ', kana: 'どこ', romaji: 'doko', en: 'where', pos: 'qword' },
  { word: '何', kana: 'なに', romaji: 'nani', en: 'what', pos: 'qword' },
  { word: '誰', kana: 'だれ', romaji: 'dare', en: 'who', pos: 'qword' },
  { word: 'いつ', kana: 'いつ', romaji: 'itsu', en: 'when', pos: 'qword' },

  // copula & core verbs
  { word: 'です', kana: 'です', romaji: 'desu', en: 'to be', pos: 'copula' },
  { word: 'する', kana: 'する', romaji: 'suru', en: 'to do', pos: 'verb' },
  { word: 'ある', kana: 'ある', romaji: 'aru', en: 'to exist (things)', pos: 'verb' },
  { word: 'いる', kana: 'いる', romaji: 'iru', en: 'to exist (people)', pos: 'verb' },
  { word: '行く', kana: 'いく', romaji: 'iku', en: 'to go', pos: 'verb' },
  { word: '来る', kana: 'くる', romaji: 'kuru', en: 'to come', pos: 'verb' },
  { word: '見る', kana: 'みる', romaji: 'miru', en: 'to see', pos: 'verb' },
  { word: '食べる', kana: 'たべる', romaji: 'taberu', en: 'to eat', pos: 'verb' },
  { word: '飲む', kana: 'のむ', romaji: 'nomu', en: 'to drink', pos: 'verb' },
  { word: '言う', kana: 'いう', romaji: 'iu', en: 'to say', pos: 'verb' },
  { word: '話す', kana: 'はなす', romaji: 'hanasu', en: 'to speak', pos: 'verb' },
  { word: '聞く', kana: 'きく', romaji: 'kiku', en: 'to listen, to ask', pos: 'verb' },
  { word: '読む', kana: 'よむ', romaji: 'yomu', en: 'to read', pos: 'verb' },
  { word: '書く', kana: 'かく', romaji: 'kaku', en: 'to write', pos: 'verb' },
  { word: '買う', kana: 'かう', romaji: 'kau', en: 'to buy', pos: 'verb' },
  { word: '分かる', kana: 'わかる', romaji: 'wakaru', en: 'to understand', pos: 'verb' },
  { word: '知る', kana: 'しる', romaji: 'shiru', en: 'to know', pos: 'verb' },
  { word: '思う', kana: 'おもう', romaji: 'omou', en: 'to think', pos: 'verb' },
  { word: '待つ', kana: 'まつ', romaji: 'matsu', en: 'to wait', pos: 'verb' },
  { word: '使う', kana: 'つかう', romaji: 'tsukau', en: 'to use', pos: 'verb' },
  { word: '作る', kana: 'つくる', romaji: 'tsukuru', en: 'to make', pos: 'verb' },

  // particles
  { word: 'は', kana: 'は', romaji: 'wa', en: 'topic particle', pos: 'part' },
  { word: 'が', kana: 'が', romaji: 'ga', en: 'subject particle', pos: 'part' },
  { word: 'を', kana: 'を', romaji: 'o', en: 'object particle', pos: 'part' },
  { word: 'に', kana: 'に', romaji: 'ni', en: 'to, at', pos: 'part' },
  { word: 'で', kana: 'で', romaji: 'de', en: 'at, by means of', pos: 'part' },
  { word: 'と', kana: 'と', romaji: 'to', en: 'and, with', pos: 'part' },
  { word: 'も', kana: 'も', romaji: 'mo', en: 'also, too', pos: 'part' },
  { word: 'の', kana: 'の', romaji: 'no', en: 'possessive particle', pos: 'part' },
  { word: 'か', kana: 'か', romaji: 'ka', en: 'question particle', pos: 'part' },
  { word: 'から', kana: 'から', romaji: 'kara', en: 'from, because', pos: 'part' },
  { word: 'まで', kana: 'まで', romaji: 'made', en: 'until, as far as', pos: 'part' },
  { word: 'でも', kana: 'でも', romaji: 'demo', en: 'but', pos: 'conj' },

  // adjectives
  { word: 'いい', kana: 'いい', romaji: 'ii', en: 'good', pos: 'adj' },
  { word: '悪い', kana: 'わるい', romaji: 'warui', en: 'bad', pos: 'adj' },
  { word: '大きい', kana: 'おおきい', romaji: 'ookii', en: 'big', pos: 'adj' },
  { word: '小さい', kana: 'ちいさい', romaji: 'chiisai', en: 'small', pos: 'adj' },
  { word: '新しい', kana: 'あたらしい', romaji: 'atarashii', en: 'new', pos: 'adj' },
  { word: '古い', kana: 'ふるい', romaji: 'furui', en: 'old', pos: 'adj' },
  { word: '高い', kana: 'たかい', romaji: 'takai', en: 'tall, expensive', pos: 'adj' },
  { word: '安い', kana: 'やすい', romaji: 'yasui', en: 'cheap', pos: 'adj' },
  { word: '暑い', kana: 'あつい', romaji: 'atsui', en: 'hot (weather)', pos: 'adj' },
  { word: '寒い', kana: 'さむい', romaji: 'samui', en: 'cold (weather)', pos: 'adj' },
  { word: '美味しい', kana: 'おいしい', romaji: 'oishii', en: 'delicious', pos: 'adj' },
  { word: '楽しい', kana: 'たのしい', romaji: 'tanoshii', en: 'fun, enjoyable', pos: 'adj' },
  { word: '忙しい', kana: 'いそがしい', romaji: 'isogashii', en: 'busy', pos: 'adj' },
  { word: '好き', kana: 'すき', romaji: 'suki', en: 'liked, favourite', pos: 'nadj' },

  // everyday nouns
  { word: '水', kana: 'みず', romaji: 'mizu', en: 'water', pos: 'noun' },
  { word: 'お茶', kana: 'おちゃ', romaji: 'ocha', en: 'tea', pos: 'noun' },
  { word: 'ご飯', kana: 'ごはん', romaji: 'gohan', en: 'rice, meal', pos: 'noun' },
  { word: '食べ物', kana: 'たべもの', romaji: 'tabemono', en: 'food', pos: 'noun' },
  { word: '家', kana: 'いえ', romaji: 'ie', en: 'house, home', pos: 'noun' },
  { word: '学校', kana: 'がっこう', romaji: 'gakkou', en: 'school', pos: 'noun' },
  { word: '会社', kana: 'かいしゃ', romaji: 'kaisha', en: 'company', pos: 'noun' },
  { word: '本', kana: 'ほん', romaji: 'hon', en: 'book', pos: 'noun' },
  { word: '車', kana: 'くるま', romaji: 'kuruma', en: 'car', pos: 'noun' },
  { word: '電車', kana: 'でんしゃ', romaji: 'densha', en: 'train', pos: 'noun' },
  { word: 'お金', kana: 'おかね', romaji: 'okane', en: 'money', pos: 'noun' },
  { word: '時間', kana: 'じかん', romaji: 'jikan', en: 'time', pos: 'noun' },
  { word: '今日', kana: 'きょう', romaji: 'kyou', en: 'today', pos: 'noun' },
  { word: '明日', kana: 'あした', romaji: 'ashita', en: 'tomorrow', pos: 'noun' },
  { word: '昨日', kana: 'きのう', romaji: 'kinou', en: 'yesterday', pos: 'noun' },
  { word: '今', kana: 'いま', romaji: 'ima', en: 'now', pos: 'noun' },
  { word: '朝', kana: 'あさ', romaji: 'asa', en: 'morning', pos: 'noun' },
  { word: '夜', kana: 'よる', romaji: 'yoru', en: 'night', pos: 'noun' },
  { word: '日本', kana: 'にほん', romaji: 'nihon', en: 'Japan', pos: 'noun' },
  { word: '日本語', kana: 'にほんご', romaji: 'nihongo', en: 'Japanese language', pos: 'noun' },
  { word: '名前', kana: 'なまえ', romaji: 'namae', en: 'name', pos: 'noun' },
  { word: '仕事', kana: 'しごと', romaji: 'shigoto', en: 'work, job', pos: 'noun' },
  { word: '天気', kana: 'てんき', romaji: 'tenki', en: 'weather', pos: 'noun' },
  { word: '猫', kana: 'ねこ', romaji: 'neko', en: 'cat', pos: 'noun' },
  { word: '犬', kana: 'いぬ', romaji: 'inu', en: 'dog', pos: 'noun' },
  { word: '花', kana: 'はな', romaji: 'hana', en: 'flower', pos: 'noun' },
  { word: '山', kana: 'やま', romaji: 'yama', en: 'mountain', pos: 'noun' },
  { word: '川', kana: 'かわ', romaji: 'kawa', en: 'river', pos: 'noun' },

  // adverbs & numbers
  { word: 'とても', kana: 'とても', romaji: 'totemo', en: 'very', pos: 'adv' },
  { word: '少し', kana: 'すこし', romaji: 'sukoshi', en: 'a little', pos: 'adv' },
  { word: 'もう', kana: 'もう', romaji: 'mou', en: 'already', pos: 'adv' },
  { word: 'まだ', kana: 'まだ', romaji: 'mada', en: 'still, not yet', pos: 'adv' },
  { word: '一', kana: 'いち', romaji: 'ichi', en: 'one', pos: 'num' },
  { word: '二', kana: 'に', romaji: 'ni', en: 'two', pos: 'num' },
  { word: '三', kana: 'さん', romaji: 'san', en: 'three', pos: 'num' },
  { word: '十', kana: 'じゅう', romaji: 'juu', en: 'ten', pos: 'num' },
]
