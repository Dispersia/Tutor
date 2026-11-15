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
  // 平板 heiban: low then high throughout
  expect(parsePitchContour({ accent: 0, syllables: ['か', 'み', 'さ', 'ま'] })?.levels).toEqual([
    'L',
    'H',
    'H',
    'H',
  ])
  // 頭高 atamadaka: high then low
  expect(pitchFromAccent(1, 3)).toEqual(['H', 'L', 'L'])
  // accent 3 of 4: only the tail falls
  expect(pitchFromAccent(3, 4)).toEqual(['L', 'H', 'H', 'L'])
})

test('parsePitchContour drops unusable input', () => {
  expect(parsePitchContour(undefined)).toBeUndefined()
  expect(parsePitchContour('')).toBeUndefined()
  expect(parsePitchContour({ levels: [] })).toBeUndefined()
  expect(parsePitchContour(42)).toBeUndefined()
})

test('pitchOf reads a contour out of card metadata', () => {
  // producers may hand us the shorthand; pitchOf normalises it
  expect(pitchOf({ pitch: 'HL' as unknown as CardMetadata['pitch'] })?.levels).toEqual(['H', 'L'])
  expect(pitchOf({ radical: '水' })).toBeUndefined()
  expect(pitchOf(undefined)).toBeUndefined()
})
