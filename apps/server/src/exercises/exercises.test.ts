import { expect, test } from 'bun:test'
import type { Card, ExerciseContext, Learner, PitchContour } from '@tutor/core'
import { exerciseCatalog, registry } from './index'
import { wordView } from './shared'

const learner: Learner = { id: 'u1', nativeLang: 'en', targetLang: 'zh', level: 'hsk1' }

function ctx(partial: Partial<Card> = {}, distractors: string[] = []): ExerciseContext {
  const card: Card = {
    id: 'c1',
    deckId: 'd1',
    type: 'vocab',
    sourceLang: 'en',
    targetLang: 'zh',
    front: 'hello',
    back: '你好',
    readings: { zhuyin: 'ㄋㄧˇ ㄏㄠˇ' },
    tags: [],
    payload: {},
    metadata: {},
    origin: 'curated',
    createdAt: 0,
    ...partial,
  }
  return { card, learner, distractors }
}

test('catalog lists the built-in exercises', () => {
  const ids = exerciseCatalog().map((e) => e.id)
  for (const id of [
    'introduce',
    'translate.front_to_back',
    'translate.back_to_front',
    'multiple_choice',
    'type_listen',
    'speak_word',
    'converse',
    'sentence_build',
    'grammar_cloze',
  ]) {
    expect(ids).toContain(id)
  }
})

test('voice drills are offered only for sentence cards, never word cards', () => {
  const sentence = ctx({
    type: 'phrase',
    back: '我喝茶。',
    payload: { tokens: ['我', '喝', '茶'], gloss: 'I drink tea.' },
  })
  const word = ctx({
    type: 'vocab',
    back: '茶',
    payload: { tokens: ['茶'], gloss: 'tea' },
  })
  for (const id of ['type_listen', 'speak_word']) {
    const def = registry.get(id)!
    expect(def.temporarilyDisabled).toBeFalsy()
    expect(def.supports(sentence.card, learner)).toBe(true)
    expect(def.supports(word.card, learner)).toBe(false)
    expect(def.supports(ctx().card, learner)).toBe(false)
  }
})

test('catalog tags every exercise with its card template', () => {
  const byId = new Map(exerciseCatalog().map((e) => [e.id, e.template]))
  expect(byId.get('translate.front_to_back')).toBe('vocab')
  expect(byId.get('type_listen')).toBe('listening')
  expect(byId.get('speak_word')).toBe('spoken')
  expect(byId.get('sentence_build')).toBe('sentence')
  expect(byId.get('grammar_cloze')).toBe('grammar')
})

test('sentence_build builds from payload tokens in any language', async () => {
  const def = registry.get('sentence_build')!
  const c = ctx({
    targetLang: 'es',
    front: 'I drink tea',
    back: 'yo bebo té',
    readings: {},
    payload: { tokens: ['yo', 'bebo', 'té'], gloss: 'I drink tea', distractors: ['agua', 'comes'] },
  })
  expect(def.supports(c.card, learner)).toBe(true)
  const inst = await def.generate(c)
  expect(inst.data.tokens).toEqual(['yo', 'bebo', 'té'])
  expect(inst.data.gloss).toBe('I drink tea')
  expect(inst.data.bank as string[]).toContain('agua')
  expect((await def.grade(c, inst, ['yo', 'bebo', 'té'])).correct).toBe(true)
  expect((await def.grade(c, inst, ['yo', 'té', 'bebo'])).correct).toBe(false)
})

test('sentence_build stays Mandarin-only without payload tokens', () => {
  const def = registry.get('sentence_build')!
  expect(def.supports(ctx({ targetLang: 'es', payload: {} }).card, learner)).toBe(false)
})

test('sentence_build never shows the whole sentence as the new-word hint', async () => {
  const def = registry.get('sentence_build')!
  const bare = ctx({
    targetLang: 'es',
    front: 'I drink tea',
    back: 'yo bebo té',
    readings: {},
    payload: { tokens: ['yo', 'bebo', 'té'], gloss: 'I drink tea' },
  })
  expect((await def.generate(bare)).data.newWord).toBeUndefined()

  const hinted = ctx({
    targetLang: 'es',
    front: 'I drink tea',
    back: 'yo bebo té',
    readings: {},
    payload: { tokens: ['yo', 'bebo', 'té'], gloss: 'I drink tea', newWord: 'té' },
  })
  expect((await def.generate(hinted)).data.newWord).toBe('té')
})

test('grammar_cloze grades a choice card from its payload (any language)', async () => {
  const def = registry.get('grammar_cloze')!
  const c = ctx({
    targetLang: 'es',
    front: 'Choose the right form: yo ___ estudiante',
    back: 'soy',
    readings: {},
    payload: {
      prompt: 'Choose the right form: yo ___ estudiante',
      answer: 'soy',
      options: ['soy', 'eres', 'es'],
      rule: 'ser',
      explanation: 'yo → soy',
    },
  })
  expect(def.supports(c.card, learner)).toBe(true)
  const inst = await def.generate(c)
  expect(inst.prompt).toContain('estudiante')
  expect(inst.data.options as string[]).toContain('soy')
  expect(inst.data.rule).toBe('ser')
  expect((await def.grade(c, inst, 'soy')).correct).toBe(true)
  const wrong = await def.grade(c, inst, 'es')
  expect(wrong.correct).toBe(false)
  expect(wrong.expected).toBe('soy')
})

test('grammar_cloze free typing defaults the answer to the card back', async () => {
  const def = registry.get('grammar_cloze')!
  const c = ctx({
    front: 'Say: I do not drink tea',
    back: '我不喝茶',
    payload: { rule: 'negation with 不' },
  })
  expect(def.supports(c.card, learner)).toBe(true)
  const inst = await def.generate(c)
  expect(inst.data.options).toBeUndefined()
  expect((await def.grade(c, inst, '我不喝茶')).correct).toBe(true)
})

test('grammar_cloze offers the answer even when the payload lists only wrong variants', async () => {
  const def = registry.get('grammar_cloze')!
  const c = ctx({
    type: 'grammar',
    front: "Let's go.",
    back: '我們去吧。',
    readings: {},
    payload: {
      answer: '我們去吧。',
      options: ['我們去嗎。', '我們去呢。', '我們去啊。'],
      rule: 'The particle 吧 makes a suggestion.',
    },
  })
  const inst = await def.generate(c)
  const options = inst.data.options as string[]
  expect(options).toContain('我們去吧。')
  expect((await def.grade(c, inst, '我們去吧。')).correct).toBe(true)
})

test('grammar_cloze is never offered for a plain word card', () => {
  const def = registry.get('grammar_cloze')!
  expect(def.supports(ctx().card, learner)).toBe(false)
})

test('introduce teaches a new word and never quizzes or schedules', async () => {
  const def = registry.get('introduce')!
  const c = ctx()
  const inst = await def.generate(c)
  expect(inst.data.word).toBe('你好')
  expect(inst.data.reading).toBe('ㄋㄧˇ ㄏㄠˇ')
  expect(inst.data.meaning).toBe('hello')
  const r = await def.grade(c, inst, 'ok')
  expect(r.correct).toBe(true)
  expect(def.xp(r, inst)).toBe(0)
})

test('introduce example is n+1: only words already met plus the new one', async () => {
  const def = registry.get('introduce')!

  const c = ctx({ back: '很', front: 'very', readings: { zhuyin: 'ㄏㄣˇ' } })
  c.seen = ['我', '好']
  c.known = []
  const inst = await def.generate(c)
  const ex = inst.data.example as { text: string; reading: string; target: string } | undefined
  expect(ex?.text).toBe('我很好')
  expect(ex?.target).toBe('很')
  expect(ex?.reading).toContain('ㄏㄣˇ')

  const bare = ctx({ back: '很', front: 'very', readings: { zhuyin: 'ㄏㄣˇ' } })
  bare.seen = ['我']
  bare.known = []
  expect((await def.generate(bare)).data.example).toBeUndefined()
})

test('introduce teaches a grammar point with a worked example', async () => {
  const def = registry.get('introduce')!
  const c = ctx({
    type: 'grammar',
    targetLang: 'ja',
    front: 'topic particle',
    back: 'は',
    readings: { kana: 'は' },
    payload: {
      template: 'grammar',
      prompt: '私___学生です。',
      answer: 'は',
      rule: 'topic particle',
      explanation: 'は marks the topic of the sentence.',
    },
  })
  const inst = await def.generate(c)
  const grammar = inst.data.grammar as {
    rule: string
    explanation?: string
    example?: { text: string; target: string }
  }
  expect(grammar.rule).toBe('topic particle')
  expect(grammar.example).toEqual({ text: '私は学生です。', target: 'は' })
  expect(grammar.explanation).toContain('topic')
})

test('introduce shows the stored known-words example for a grammar point', async () => {
  const def = registry.get('introduce')!
  const c = ctx({
    type: 'grammar',
    targetLang: 'ja',
    front: 'topic particle',
    back: 'は',
    readings: { kana: 'は' },
    payload: {
      template: 'grammar',
      rule: 'topic particle',
      answer: 'は',
      example: {
        text: '私は学生です。',
        reading: 'わたしはがくせいです',
        gloss: 'I am a student.',
      },
    },
  })
  const inst = await def.generate(c)
  const grammar = inst.data.grammar as {
    example?: { text: string; reading?: string; gloss?: string }
  }
  expect(grammar.example).toEqual({
    text: '私は学生です。',
    reading: 'わたしはがくせいです',
    gloss: 'I am a student.',
  })
})

test('introduce shows no grammar block for a plain word card', async () => {
  const inst = await registry.get('introduce')!.generate(ctx())
  expect(inst.data.grammar).toBeUndefined()
})

test('introduce keeps the explanation of a word card that named a point', async () => {
  const inst = await registry.get('introduce')!.generate(
    ctx({
      targetLang: 'ja',
      front: 'Topic particle: は',
      back: 'は',
      readings: { kana: 'は' },
      payload: {
        explanation: 'は marks the topic and is read わ.',
        example: { text: '私は人です。', gloss: 'I am a person.' },
      },
    }),
  )
  expect(inst.data.grammar).toBeUndefined()
  expect(inst.data.explanation).toBe('は marks the topic and is read わ.')
  expect(inst.data.example).toMatchObject({ text: '私は人です。', gloss: 'I am a person.' })
})

test('readings are locale-aware: Zhuyin for Chinese, furigana for Japanese', async () => {
  const def = registry.get('translate.back_to_front')!

  const zh = ctx({ readings: { zhuyin: 'ㄋㄧˇ ㄏㄠˇ' } })
  const zhInst = await def.generate(zh)
  expect(zhInst.data.reading).toBe('ㄋㄧˇ ㄏㄠˇ')

  const legacy = ctx({ readings: { pinyin: 'nǐ hǎo' } })
  expect((await def.generate(legacy)).data.reading).toBe('ㄋㄧˇ ㄏㄠˇ')

  const ja = ctx({
    targetLang: 'ja',
    back: '食べる',
    front: 'to eat',
    readings: { kana: 'たべる' },
  })
  const jaInst = await def.generate(ja)
  expect(jaInst.data.reading).toBe('たべる')
  expect(jaInst.data.furigana).toEqual([{ base: '食', ruby: 'た' }, { base: 'べる' }])
})

test('pitch is shown only for Japanese cards', () => {
  const pitch: PitchContour = { levels: ['L', 'H'], syllables: ['학', '생'], drop: null }
  const ko = ctx({
    targetLang: 'ko',
    front: 'student',
    back: '학생',
    readings: {},
    metadata: { pitch },
  })
  const ja = ctx({
    targetLang: 'ja',
    front: 'to eat',
    back: '食べる',
    readings: { kana: 'たべる' },
    metadata: { pitch },
  })
  expect(wordView(ko).pitch).toBeUndefined()
  expect(wordView(ja).pitch).toEqual(pitch)
})

test('translate.front_to_back: exact and via reading', async () => {
  const def = registry.get('translate.front_to_back')!
  const c = ctx()
  const inst = await def.generate(c)
  expect(inst.prompt).toContain('hello')
  expect((await def.grade(c, inst, '你好')).correct).toBe(true)
  expect((await def.grade(c, inst, 'ㄋㄧˇ ㄏㄠˇ')).score).toBe(100)
  const wrong = await def.grade(c, inst, '再見')
  expect(wrong.correct).toBe(false)
  expect(wrong.expected).toBe('你好')
  expect(def.xp({ score: 100, correct: true }, inst)).toBe(15)
  expect(def.xp({ score: 40, correct: false }, inst)).toBe(1)
})

test('translate.back_to_front', async () => {
  const def = registry.get('translate.back_to_front')!
  const c = ctx()
  const inst = await def.generate(c)
  expect(inst.data.word).toBe('你好')
  expect(inst.data.reading).toBe('ㄋㄧˇ ㄏㄠˇ')
  expect((await def.grade(c, inst, 'hello')).correct).toBe(true)
})

test('translate feedback drops a reading that repeats the word', async () => {
  const def = registry.get('translate.front_to_back')!
  const kana = ctx({ targetLang: 'ja', front: 'you', back: 'あなた', readings: { kana: 'あなた' } })
  const kanaInst = await def.generate(kana)
  expect((await def.grade(kana, kanaInst, 'わたし')).feedback).toBe(
    'Not quite. The answer is あなた.',
  )

  const kanji = ctx({
    targetLang: 'ja',
    front: 'student',
    back: '学生',
    readings: { kana: 'がくせい' },
  })
  const kanjiInst = await def.generate(kanji)
  expect((await def.grade(kanji, kanjiInst, 'せんせい')).feedback).toContain('学生 (がくせい)')
})

test('translate.back_to_front accepts any listed sense of a multi-sense gloss', async () => {
  const def = registry.get('translate.back_to_front')!
  const c = ctx({ back: '的', front: 'of / possessive particle / nominalizer' })
  const inst = await def.generate(c)
  for (const answer of ['of', 'possessive particle', 'nominalizer', 'Possessive Particle']) {
    const r = await def.grade(c, inst, answer)
    expect(r.correct).toBe(true)
    expect(r.score).toBe(100)
  }
  expect((await def.grade(c, inst, 'question particle')).correct).toBe(false)
})

test('translate.back_to_front asks the judge before rejecting a paraphrase', async () => {
  const def = registry.get('translate.back_to_front')!
  const c = ctx({ back: '的', front: 'of / possessive particle / nominalizer' })
  const inst = await def.generate(c)

  c.judge = async () => ({ score: 88, correct: true, feedback: 'Yes — a genitive marker.' })
  const accepted = await def.grade(c, inst, 'genitive marker')
  expect(accepted.correct).toBe(true)
  expect(accepted.feedback).toContain('genitive')

  c.judge = async () => ({ score: 0, correct: false, feedback: 'Not this sense.' })
  const rejected = await def.grade(c, inst, 'water')
  expect(rejected.correct).toBe(false)
})

test('a drill that shows the meaning never has the answer inside it', () => {
  const point = ctx({
    type: 'grammar',
    front: 'Adverb before an adjective: 很',
    back: '很',
    payload: { template: 'grammar', answer: '很', rule: 'Adverb before an adjective' },
  })
  const plain = ctx({ front: 'very', back: '很' })
  for (const id of ['multiple_choice', 'translate.front_to_back']) {
    expect(registry.get(id)!.supports(point.card, learner)).toBe(false)
    expect(registry.get(id)!.supports(plain.card, learner)).toBe(true)
  }
})

test('multiple_choice generates choices incl. the answer and grades exactly', async () => {
  const def = registry.get('multiple_choice')!
  const c = ctx({}, ['再見', '謝謝', '我'])
  const inst = await def.generate(c)
  const choices = inst.data.choices as string[]
  expect(choices).toContain('你好')
  expect(choices.length).toBe(4)
  expect((await def.grade(c, inst, '你好')).correct).toBe(true)
  expect((await def.grade(c, inst, '再見')).correct).toBe(false)
})

test('multiple_choice makes sentence options for a sentence card', async () => {
  const def = registry.get('multiple_choice')!
  const c = ctx({
    type: 'phrase',
    front: 'I drink tea.',
    back: '我喝茶',
    payload: { tokens: ['我', '喝', '茶'], gloss: 'I drink tea.', distractors: ['你', '他'] },
  })
  const inst = await def.generate(c)
  const choices = inst.data.choices as string[]
  expect(choices).toContain('我喝茶')
  expect(choices).toContain('你喝茶')
  expect(choices).toContain('他喝茶')
  expect((await def.grade(c, inst, '你喝茶')).correct).toBe(false)
})

test('multiple_choice swaps the closest word in a Japanese sentence', async () => {
  const def = registry.get('multiple_choice')!
  const c = ctx({
    targetLang: 'ja',
    type: 'phrase',
    front: 'Today is Friday.',
    back: '本日は金曜日です',
    payload: { tokens: ['本日', 'は', '金曜日', 'です'], distractors: ['土曜日', '月曜日'] },
  })
  const inst = await def.generate(c)
  const choices = inst.data.choices as string[]
  expect(choices).toContain('本日は金曜日です')
  expect(choices).toContain('本日は土曜日です')
  expect(choices).toContain('本日は月曜日です')
})

test('multiple_choice furigana comes from the word readings, not the sentence kana', async () => {
  const def = registry.get('multiple_choice')!
  const c: ExerciseContext = {
    ...ctx({
      targetLang: 'ja',
      type: 'phrase',
      front: 'What is this?',
      back: 'これは何ですか。',
      readings: { kana: 'これはなんですか' },
      payload: {
        tokens: ['これ', 'は', '何', 'です', 'か'],
        gloss: 'What is this?',
        distractors: ['あなた', '私'],
      },
    }),
    readings: {
      これ: 'これ',
      は: 'は',
      何: 'なに',
      です: 'です',
      か: 'か',
      あなた: 'あなた',
      私: 'わたし',
    },
  }
  const inst = await def.generate(c)
  const choices = inst.data.choices as string[]
  const furigana = inst.data.choiceFurigana as ({ base: string; ruby?: string }[] | undefined)[]
  const render = (segs: { base: string; ruby?: string }[] | undefined) =>
    (segs ?? []).map((s) => (s.ruby ? `${s.base}[${s.ruby}]` : s.base)).join('')
  expect(render(furigana[choices.indexOf('これは何ですか。')])).toBe('これは何[なに]ですか。')
  expect(render(furigana[choices.findIndex((choice) => choice.includes('私'))])).toBe(
    'これ私[わたし]何[なに]ですか',
  )
})

test('type_listen exposes audio text', async () => {
  const def = registry.get('type_listen')!
  const c = ctx()
  const inst = await def.generate(c)
  expect(inst.data.audioText).toBe('你好')
  expect((await def.grade(c, inst, '你好')).correct).toBe(true)
})

test('type_listen accepts a homophone the audio cannot distinguish', async () => {
  const def = registry.get('type_listen')!
  const c = ctx({ type: 'phrase', back: '她很好。' })
  const inst = await def.generate(c)
  const r = await def.grade(c, inst, '他很好。')
  expect(r.correct).toBe(true)
  expect(r.score).toBe(100)
  const wrong = await def.grade(c, inst, '他不好。')
  expect(wrong.correct).toBe(false)
})

test('speak_word grades a transcript', async () => {
  const def = registry.get('speak_word')!
  const c = ctx()
  const inst = await def.generate(c)
  const good = await def.grade(c, inst, '你好')
  expect(good.correct).toBe(true)
  expect(good.detail?.transcript).toBe('你好')
  const empty = await def.grade(c, inst, '')
  expect(empty.correct).toBe(false)
})

test('speak_word accepts a homophone for the expected character', async () => {
  const def = registry.get('speak_word')!
  const c = ctx({ type: 'phrase', back: '他很好。' })
  const inst = await def.generate(c)
  const r = await def.grade(c, inst, '她很好。')
  expect(r.correct).toBe(true)
  expect(r.score).toBe(100)
})

test('converse without a judge falls back to a heuristic', async () => {
  const def = registry.get('converse')!
  const c = ctx()
  const inst = await def.generate(c)
  const used = await def.grade(c, inst, '你好，我是學生。')
  expect(used.correct).toBe(true)
  expect(used.score).toBeGreaterThanOrEqual(60)
  const missed = await def.grade(c, inst, '我是學生。')
  expect(missed.correct).toBe(false)
  const english = await def.grade(c, inst, 'hello there')
  expect(english.correct).toBe(false)
})

test('converse rejects the bare word without a sentence', async () => {
  const def = registry.get('converse')!
  const c = ctx()
  const inst = await def.generate(c)
  const bare = await def.grade(c, inst, '你好')
  expect(bare.correct).toBe(false)
  expect(bare.score).toBeLessThan(60)
  const padded = await def.grade(c, inst, '  你好。 ')
  expect(padded.correct).toBe(false)
})

test('converse is not offered for cards that already are a sentence', () => {
  const def = registry.get('converse')!
  const sentence = ctx({
    type: 'phrase',
    back: '你要什麼？',
    payload: { tokens: ['你', '要', '什麼'] },
  })
  expect(def.supports(sentence.card, learner)).toBe(false)
  expect(def.supports(ctx({ type: 'phrase', back: '你好嗎？' }).card, learner)).toBe(false)
  expect(def.supports(ctx().card, learner)).toBe(true)
})

test('converse waits until the learner has met a sentence or a base of words', () => {
  const def = registry.get('converse')!
  expect(def.available!(ctx())).toBe(false)
  const words = ['一', '二', '三', '四', '五']
  const readings = Object.fromEntries(words.map((word) => [word, 'x']))
  expect(def.available!({ ...ctx(), known: words, readings })).toBe(true)
  const met = { ...ctx(), known: ['你好'], seen: ['你好', '我喝茶。'], utterances: ['我喝茶。'] }
  expect(def.available!(met)).toBe(true)
})

test('converse uses the injected judge when present', async () => {
  const def = registry.get('converse')!
  const c = ctx()
  c.judge = async () => ({ score: 91, correct: true, feedback: 'Great use of the word.' })
  const inst = await def.generate(c)
  const r = await def.grade(c, inst, '我喜歡你好嗎')
  expect(r.score).toBe(91)
  expect(r.feedback).toContain('Great')
})

test('converse passes a correct use of the word and notes the rest', async () => {
  const def = registry.get('converse')!
  const c = ctx()
  c.judge = async () => ({
    wordCorrect: true,
    score: 40,
    correct: false,
    feedback: 'Good use of 你好. Note: 學生 is written with a different character here.',
  })
  const inst = await def.generate(c)
  const used = await def.grade(c, inst, '你好，我是學生。')
  expect(used.correct).toBe(true)
  expect(used.score).toBe(75)
  expect(used.feedback).toContain('Note')
})

test('converse fails a word that is there but used wrongly', async () => {
  const def = registry.get('converse')!
  const c = ctx()
  c.judge = async () => ({
    wordCorrect: false,
    score: 30,
    correct: false,
    feedback: 'A different word belongs here.',
  })
  const inst = await def.generate(c)
  const misused = await def.grade(c, inst, '你好，我是學生。')
  expect(misused.correct).toBe(false)
  expect(misused.score).toBe(30)
  const missing = await def.grade(c, inst, '我是學生。')
  expect(missing.correct).toBe(false)
})

test("converse asks the judge for the tip in the learner's native language", async () => {
  const def = registry.get('converse')!
  const c = ctx()
  let prompt = ''
  c.judge = async (p) => {
    prompt = p
    return { score: 90, correct: true, feedback: 'ok' }
  }
  const inst = await def.generate(c)
  await def.grade(c, inst, '我喜歡你好嗎')
  expect(prompt).toContain('feedback, in English')
  expect(prompt).toContain("Never offer the learner's own sentence back")
})

test('translate.back_to_front asks the judge for native-language feedback', async () => {
  const def = registry.get('translate.back_to_front')!
  const c = ctx({ back: '的', front: 'of / possessive particle / nominalizer' })
  let prompt = ''
  c.judge = async (p) => {
    prompt = p
    return { score: 88, correct: true, feedback: 'ok' }
  }
  const inst = await def.generate(c)
  await def.grade(c, inst, 'genitive marker')
  expect(prompt).toContain('one short English sentence')
})

test('speak_word.gradeAudio uses the injected assessor', async () => {
  const def = registry.get('speak_word')!
  const c = ctx()
  const inst = await def.generate(c)
  c.assess = async () => ({
    transcript: '你好',
    items: [
      { text: '你', start: 0.1, end: 0.4 },
      { text: '好', start: 0.4, end: 0.7 },
    ],
    duration: 1.1,
  })
  const r = await def.gradeAudio!(c, inst, new Uint8Array())
  expect(r.correct).toBe(true)
  expect(r.detail?.transcript).toBe('你好')
  expect(Array.isArray(r.detail?.words)).toBe(true)
})

test('speak_word.gradeAudio asks for a retry when the clip had no speech', async () => {
  const def = registry.get('speak_word')!
  const c = ctx()
  const inst = await def.generate(c)
  let judged = false
  c.assess = async () => ({ transcript: '', items: [], duration: 0.2, noSpeech: true })
  c.judge = async () => {
    judged = true
    return undefined
  }
  const r = await def.gradeAudio!(c, inst, new Uint8Array())
  expect(r.detail?.noSpeech).toBe(true)
  expect(r.correct).toBe(false)
  expect(r.feedback).toMatch(/catch|again/i)
  expect(judged).toBe(false)
})

test('speak_word.gradeAudio detects a missing word', async () => {
  const def = registry.get('speak_word')!
  const c = ctx({ back: '你好世界' })
  const inst = await def.generate(c)
  c.assess = async () => ({
    transcript: '你好',
    items: [
      { text: '你', start: 0, end: 0.3 },
      { text: '好', start: 0.3, end: 0.6 },
    ],
    duration: 0.6,
  })
  const r = await def.gradeAudio!(c, inst, new Uint8Array())
  expect(r.correct).toBe(false)
  expect((r.detail?.missing as string[]).sort()).toEqual(['世', '界'])
})

test('speak_word.gradeAudio prefers the judge result', async () => {
  const def = registry.get('speak_word')!
  const c = ctx()
  const inst = await def.generate(c)
  c.assess = async () => ({
    transcript: '你好',
    items: [
      { text: '你', start: 0, end: 0.3 },
      { text: '好', start: 0.3, end: 0.6 },
    ],
    duration: 0.4,
  })
  c.judge = async () => ({
    score: 88,
    correct: true,
    summary: 'Good tones.',
    words: [
      { text: '你', ok: true, tip: '' },
      { text: '好', ok: true, tip: 'tone 3' },
    ],
  })
  const r = await def.gradeAudio!(c, inst, new Uint8Array())
  expect(r.score).toBe(88)
  expect(r.feedback).toBe('Good tones.')
  expect((r.detail?.words as { tip: string }[])[1]!.tip).toBe('tone 3')
})

test('speak_word.gradeAudio accepts a Taiwan-accent sh → s realisation', async () => {
  const def = registry.get('speak_word')!
  const c = ctx({ back: '是', readings: { zhuyin: 'ㄕˋ' } })
  const inst = await def.generate(c)
  c.assess = async () => ({
    transcript: '四',
    items: [{ text: '是', start: 0.1, end: 0.5 }],
    duration: 0.6,
  })
  const r = await def.gradeAudio!(c, inst, new Uint8Array())
  expect(r.correct).toBe(true)
  expect(r.detail?.missing).toEqual([])
})

test('speak_word.gradeAudio keeps a homophone attempt correct even if the judge disagrees', async () => {
  const def = registry.get('speak_word')!
  const c = ctx({ type: 'phrase', back: '他很好。' })
  const inst = await def.generate(c)
  c.assess = async () => ({
    transcript: '她很好。',
    items: [
      { text: '他', start: 0.1, end: 0.3 },
      { text: '很', start: 0.3, end: 0.5 },
      { text: '好', start: 0.5, end: 0.8 },
    ],
    duration: 1.0,
  })
  let prompt = ''
  c.judge = async (p) => {
    prompt = p
    return {
      score: 40,
      correct: false,
      summary: 'You said 她, not 他.',
      words: [
        { text: '他', ok: false, tip: 'say 他' },
        { text: '很', ok: true, tip: '' },
        { text: '好', ok: true, tip: '' },
      ],
    }
  }
  const r = await def.gradeAudio!(c, inst, new Uint8Array())
  expect(prompt).toContain('same pronunciation')
  expect(r.correct).toBe(true)
  expect(r.score).toBeGreaterThanOrEqual(90)
  expect((r.detail?.words as { ok: boolean }[])[0]!.ok).toBe(true)
})

test('speak_word.gradeAudio hands the judge the exact reading, not a Latin approximation', async () => {
  const def = registry.get('speak_word')!
  const c = ctx({ back: '是', readings: { zhuyin: 'ㄕˋ' } })
  const inst = await def.generate(c)
  let prompt = ''
  c.assess = async () => ({
    transcript: '四',
    items: [{ text: '是', start: 0.1, end: 0.5 }],
    duration: 0.6,
  })
  c.judge = async (p) => {
    prompt = p
    return { score: 100, correct: true, summary: 'ok', words: [{ text: '是', ok: true, tip: '' }] }
  }
  const r = await def.gradeAudio!(c, inst, new Uint8Array())
  expect(prompt).toContain('ㄕˋ')
  expect(prompt).toContain('Taiwan')
  expect(prompt).toContain('Never spell a sound in Latin letters')
  expect(r.score).toBe(100)
})

test('every typing exercise names the language of its answer (keyboard hint)', async () => {
  const cases: [string, Partial<Card>, string][] = [
    ['translate.front_to_back', { payload: {} }, 'zh'],
    ['translate.back_to_front', {}, 'en'],
    ['type_listen', {}, 'zh'],
    ['converse', {}, 'zh'],
    ['grammar_cloze', { payload: { rule: 'negation with 不' } }, 'zh'],
    ['sentence_build', { payload: { tokens: ['我', '喝'], gloss: 'I drink' } }, 'zh'],
  ]
  for (const [id, card, lang] of cases) {
    const inst = await registry.get(id)!.generate(ctx(card))
    expect(inst.data.answerLang).toBe(lang)
  }

  const es = await registry.get('sentence_build')!.generate(
    ctx({
      targetLang: 'es',
      back: 'yo bebo té',
      front: 'I drink tea',
      readings: {},
      payload: { tokens: ['yo', 'bebo', 'té'], gloss: 'I drink tea' },
    }),
  )
  expect(es.data.answerLang).toBe('es')
})
