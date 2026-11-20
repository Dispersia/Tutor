import { expect, test } from 'bun:test'
import type { Card, ExerciseContext, Learner } from '@tutor/core'
import { exerciseCatalog, registry } from './index'

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
  // A generated sentence card with no explicit `newWord` used to fall back to
  // `back` — printing the answer under the tiles.
  const bare = ctx({
    targetLang: 'es',
    front: 'I drink tea',
    back: 'yo bebo té',
    readings: {},
    payload: { tokens: ['yo', 'bebo', 'té'], gloss: 'I drink tea' },
  })
  expect((await def.generate(bare)).data.newWord).toBeUndefined()

  // An explicit new word is still surfaced as the hint.
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

test('grammar_cloze is never offered for a plain word card', () => {
  const def = registry.get('grammar_cloze')!
  expect(def.supports(ctx().card, learner)).toBe(false)
})

test('introduce teaches a new word and never quizzes or schedules', async () => {
  const def = registry.get('introduce')!
  const c = ctx()
  const inst = await def.generate(c)
  expect(inst.data.word).toBe('你好')
  expect(inst.data.reading).toBe('ㄋㄧˇ ㄏㄠˇ') // Zhuyin, never pinyin
  expect(inst.data.meaning).toBe('hello')
  const r = await def.grade(c, inst, 'ok')
  expect(r.correct).toBe(true)
  expect(def.xp(r, inst)).toBe(0)
})

test('introduce example is n+1: only words already met plus the new one', async () => {
  const def = registry.get('introduce')!

  // enough prior words -> a sentence is taught, using only those words
  const c = ctx({ back: '很', front: 'very', readings: { zhuyin: 'ㄏㄣˇ' } })
  c.seen = ['我', '好']
  c.known = []
  const inst = await def.generate(c)
  const ex = inst.data.example as { text: string; reading: string; target: string } | undefined
  expect(ex?.text).toBe('我很好')
  expect(ex?.target).toBe('很')
  expect(ex?.reading).toContain('ㄏㄣˇ') // Zhuyin, never pinyin

  // without the supporting words there is no sentence to teach (never guesses)
  const bare = ctx({ back: '很', front: 'very', readings: { zhuyin: 'ㄏㄣˇ' } })
  bare.seen = ['我']
  bare.known = []
  expect((await def.generate(bare)).data.example).toBeUndefined()
})

test('readings are locale-aware: Zhuyin for Chinese, furigana for Japanese', async () => {
  const def = registry.get('translate.back_to_front')!

  const zh = ctx({ readings: { zhuyin: 'ㄋㄧˇ ㄏㄠˇ' } })
  const zhInst = await def.generate(zh)
  expect(zhInst.data.reading).toBe('ㄋㄧˇ ㄏㄠˇ')

  // a legacy pinyin-only reading is converted to Zhuyin, never shown as Latin
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

test('translate.front_to_back: exact and via reading', async () => {
  const def = registry.get('translate.front_to_back')!
  const c = ctx()
  const inst = await def.generate(c)
  expect(inst.prompt).toContain('hello')
  expect((await def.grade(c, inst, '你好')).correct).toBe(true)
  expect((await def.grade(c, inst, 'ㄋㄧˇ ㄏㄠˇ')).score).toBe(100) // zhuyin reading accepted
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
  expect(inst.data.reading).toBe('ㄋㄧˇ ㄏㄠˇ') // Zhuyin, never pinyin
  expect((await def.grade(c, inst, 'hello')).correct).toBe(true)
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
  // an unrelated answer is still wrong
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

test('type_listen exposes audio text', async () => {
  const def = registry.get('type_listen')!
  const c = ctx()
  const inst = await def.generate(c)
  expect(inst.data.audioText).toBe('你好')
  expect((await def.grade(c, inst, '你好')).correct).toBe(true)
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

test('converse without a judge falls back to a heuristic', async () => {
  const def = registry.get('converse')!
  const c = ctx()
  const inst = await def.generate(c)
  // Using the word is what counts, even when the sentence is not grammatical.
  const used = await def.grade(c, inst, '你好，我是學生。')
  expect(used.correct).toBe(true)
  expect(used.score).toBeGreaterThanOrEqual(60)
  // A target-language sentence that never uses the word is not an attempt at it.
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
  // Punctuation around the word is still the word on its own.
  const padded = await def.grade(c, inst, '  你好。 ')
  expect(padded.correct).toBe(false)
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

test('every typing exercise names the language of its answer (keyboard hint)', async () => {
  // The client spreads this onto the input's `lang` so the platform can hint the
  // right keyboard / IME — it cannot switch it for us (docs/DESIGN.md §14.2).
  const cases: [string, Partial<Card>, string][] = [
    ['translate.front_to_back', { payload: {} }, 'zh'],
    // the answer is in the learner's own language, not the target
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

  // a non-Chinese target reports its own language
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
