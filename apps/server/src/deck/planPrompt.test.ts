import { expect, test } from 'bun:test'
import { planPrompt } from './planPrompt'

interface ExampleCard {
  template: string
  front: string
  back: string
  payload?: Record<string, unknown>
}

function exampleCards(targetLang: string): ExampleCard[] {
  const text = planPrompt({
    instruction: 'x',
    targetLang,
    sourceLang: 'en',
    words: ['a'],
    knownWords: [],
    count: 1,
  })
  const json = text.slice(text.indexOf('{'))
  return (JSON.parse(json) as { cards: ExampleCard[] }).cards
}

test('the worked example teaches its grammar point instead of naming it', () => {
  for (const lang of ['ja', 'ko', 'zh']) {
    const point = exampleCards(lang).find((c) => c.template === 'grammar')!
    expect(point).toBeDefined()
    expect(String(point.payload?.explanation ?? '').length).toBeGreaterThan(40)
  }
})

test('a grammar-point word is introduced by a grammar card, never a vocab card', () => {
  for (const lang of ['ja', 'ko']) {
    const cards = exampleCards(lang)
    const point = cards.find((c) => c.template === 'grammar' && c.front.includes(c.back))!
    expect(point).toBeDefined()
    expect(point.payload?.intro).toBe(true)
    expect(cards.some((c) => c.template === 'vocab' && c.back === point.back)).toBe(false)
  }
})
