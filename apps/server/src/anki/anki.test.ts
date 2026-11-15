import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readApkg, type AnkiDeck } from './parse'
import { cleanField, inspectAnki, wordsFromAnki } from './words'
import { unzip } from './zip'

const fixture = () =>
  new Uint8Array(readFileSync(join(import.meta.dir, 'fixtures/sample.apkg')))

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
      { fields: ['hello', '我'], tags: [], order: 1 },
      { fields: ['you', '你'], tags: [], order: 2 },
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
      { fields: ['hello', '我', 'ㄨㄛˇ'], tags: [], order: 1 },
      { fields: ['you', '你', 'ㄋㄧˇ'], tags: [], order: 2 },
    ],
  }
  const list = wordsFromAnki(deck, 'zh', { wordField: 1, readingField: 2, meaningField: 0 })
  expect(list.words).toEqual(['我', '你'])
  expect(list.wordField).toBe(1)
  expect(list.readings['我']).toBe('ㄨㄛˇ')
  expect(list.meanings['你']).toBe('you')
})

test('cleanField strips Anki HTML and sound markup', () => {
  expect(cleanField('<b>茶</b>[sound:tea.mp3]&nbsp;')).toBe('茶')
  expect(cleanField('to <br>drink')).toBe('to drink')
})
