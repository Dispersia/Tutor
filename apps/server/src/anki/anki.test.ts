import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readApkg, type AnkiDeck } from './parse'
import { cleanField, detectLanguage, inspectAnki, wordsFromAnki } from './words'
import { unzip } from './zip'

const fixture = () => new Uint8Array(readFileSync(join(import.meta.dir, 'fixtures/sample.apkg')))

const modernFixture = () =>
  new Uint8Array(readFileSync(join(import.meta.dir, 'fixtures/modern-schema18.apkg')))

test('unzip reads deflated zip entries', async () => {
  const entries = await unzip(fixture())
  expect(entries.has('collection.anki2')).toBe(true)
  expect(entries.get('collection.anki2')!.length).toBeGreaterThan(0)
})

test('readApkg reads notes, models and the deck name', async () => {
  const deck = await readApkg(fixture())
  expect(deck.name).toBe('Imported Chinese')
  expect(deck.notes.length).toBe(4)
  expect(deck.notes[0]!.fields).toEqual(['我', 'ㄨㄛˇ', 'I, me'])
  expect(deck.models['1000']!.fields).toEqual(['Word', 'Reading', 'Meaning'])
})

test('wordsFromAnki extracts an ordered word list with reading/meaning hints', async () => {
  const deck = await readApkg(fixture())
  const list = wordsFromAnki(deck, 'zh')
  expect(list.words).toEqual(['我', '你', '喝', '茶'])
  expect(list.wordField).toBe(0)
  expect(list.readings['喝']).toBe('ㄏㄜ')
  expect(list.meanings['茶']).toBe('tea')
})

test('wordsFromAnki guesses the word field by target script', () => {
  const deck: AnkiDeck = {
    models: { '1': { name: 'X', fields: ['Meaning', 'Word'] } },
    notes: [
      { mid: 1, fields: ['hello', '我'], tags: [], order: 1 },
      { mid: 1, fields: ['you', '你'], tags: [], order: 2 },
    ],
  }
  const list = wordsFromAnki(deck, 'zh')
  expect(list.wordField).toBe(1)
  expect(list.words).toEqual(['我', '你'])
})

test('inspectAnki previews the fields and suggests indices', async () => {
  const deck = await readApkg(fixture())
  const info = inspectAnki(deck, 'zh')
  expect(info.fields).toEqual(['Word', 'Reading', 'Meaning'])
  expect(info.noteCount).toBe(4)
  expect(info.sample[0]).toEqual(['我', 'ㄨㄛˇ', 'I, me'])
  expect(info.suggested).toEqual({ wordField: 0, readingField: 1, meaningField: 2 })
})

test('wordsFromAnki honours an explicit field choice (no guessing)', () => {
  const deck: AnkiDeck = {
    models: { '1': { name: 'X', fields: ['Meaning', 'Word', 'Reading'] } },
    notes: [
      { mid: 1, fields: ['hello', '我', 'ㄨㄛˇ'], tags: [], order: 1 },
      { mid: 1, fields: ['you', '你', 'ㄋㄧˇ'], tags: [], order: 2 },
    ],
  }
  const list = wordsFromAnki(deck, 'zh', { wordField: 1, readingField: 2, meaningField: 0 })
  expect(list.words).toEqual(['我', '你'])
  expect(list.wordField).toBe(1)
  expect(list.readings['我']).toBe('ㄨㄛˇ')
  expect(list.meanings['你']).toBe('you')
})

test('readApkg handles a modern schema-18 package (WAL + unicase collation)', async () => {
  const deck = await readApkg(modernFixture())
  expect(deck.name).toBe('Imported Modern')
  expect(deck.notes.length).toBe(4)
  expect(deck.models['1000']!.fields).toEqual(['Word', 'Reading', 'Meaning'])
})

test('inspectAnki previews a modern package from the v18 tables', async () => {
  const deck = await readApkg(modernFixture())
  const info = inspectAnki(deck, 'zh')
  expect(info.fields).toEqual(['Word', 'Reading', 'Meaning'])
  expect(info.sample[0]).toEqual(['我', 'ㄨㄛˇ', 'I, me'])
  expect(info.suggested).toEqual({ wordField: 0, readingField: 1, meaningField: 2 })
})

test('detectLanguage reads the deck script (kana → ja, han → zh, hangul → ko)', () => {
  const deck = (words: string[]): AnkiDeck => ({
    models: { '1': { name: 'X', fields: ['Word'] } },
    notes: words.map((w, i) => ({ mid: 1, fields: [w], tags: [], order: i })),
  })
  expect(detectLanguage(deck(['食べる', '飲む']))).toBe('ja')
  expect(detectLanguage(deck(['吃', '喝']))).toBe('zh')
  expect(detectLanguage(deck(['먹다']))).toBe('ko')
  expect(detectLanguage(deck(['comer']))).toBeUndefined()
})

test('inspectAnki reports the detected language', async () => {
  const deck = await readApkg(modernFixture())
  expect(inspectAnki(deck, 'zh').suggestedLang).toBe('zh')
})

test('cleanField strips Anki HTML and sound markup', () => {
  expect(cleanField('<b>茶</b>[sound:tea.mp3]&nbsp;')).toBe('茶')
  expect(cleanField('to <br>drink')).toBe('to drink')
})

test('unzip inflates only the entries the filter asks for', async () => {
  const all = await unzip(modernFixture())
  expect([...all.keys()].sort()).toEqual(['collection.anki21b', 'media', 'meta'])
  const opened: string[] = []
  const only = await unzip(modernFixture(), {
    filter: (name) => {
      opened.push(name)
      return name.startsWith('collection.')
    },
  })
  expect([...only.keys()]).toEqual(['collection.anki21b'])
  expect(opened.sort()).toEqual(['collection.anki21b', 'media', 'meta'])
})

test('unzip refuses an entry that inflates past the size cap', async () => {
  await expect(unzip(fixture(), { maxEntryBytes: 1000 })).rejects.toThrow(/larger than the 1000/)
  const none = await unzip(fixture(), { maxEntryBytes: 1000, filter: () => false })
  expect(none.size).toBe(0)
})

test('a zstd frame’s declared size is read from its header', async () => {
  const { zstdContentSize } = await import('./parse')
  const raw = new Uint8Array(100_000).fill(7)
  expect(zstdContentSize(Bun.zstdCompressSync(raw))).toBe(100_000)
  expect(zstdContentSize(new Uint8Array([1, 2, 3, 4, 5, 6]))).toBeUndefined()
})
