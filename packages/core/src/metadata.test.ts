import { expect, test } from 'bun:test'
import { parsePitchContour, pitchFromAccent, pitchOf, type CardMetadata } from './metadata'

test('parsePitchContour accepts the "LHHL" shorthand', () => {
  expect(parsePitchContour('LHHL')).toEqual({ levels: ['L', 'H', 'H', 'L'], drop: null })
})

test('parsePitchContour normalises an explicit contour', () => {
  expect(parsePitchContour({ syllables: ['か', 'み'], levels: ['l', 'h'], drop: 2 })).toEqual({
    syllables: ['か', 'み'],
    levels: ['L', 'H'],
    drop: 2,
  })
})

test('parsePitchContour derives levels from an accent number + syllables', () => {
  expect(parsePitchContour({ accent: 0, syllables: ['か', 'み', 'さ', 'ま'] })?.levels).toEqual([
    'L',
    'H',
    'H',
    'H',
  ])
  expect(pitchFromAccent(1, 3)).toEqual(['H', 'L', 'L'])
  expect(pitchFromAccent(3, 4)).toEqual(['L', 'H', 'H', 'L'])
})

test('parsePitchContour drops unusable input', () => {
  expect(parsePitchContour(undefined)).toBeUndefined()
  expect(parsePitchContour('')).toBeUndefined()
  expect(parsePitchContour({ levels: [] })).toBeUndefined()
  expect(parsePitchContour(42)).toBeUndefined()
})

test('pitchOf reads a contour out of card metadata', () => {
  expect(pitchOf({ pitch: 'HL' as unknown as CardMetadata['pitch'] })?.levels).toEqual(['H', 'L'])
  expect(pitchOf({ radical: '水' })).toBeUndefined()
  expect(pitchOf(undefined)).toBeUndefined()
})
