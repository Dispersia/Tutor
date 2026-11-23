import { describe, expect, test } from 'bun:test'
import { encodeWav, speechWindows, spliceWindows, spokenMs } from './audio'

describe('speechWindows', () => {
  test('pads each utterance and merges anything the padding joins up', () => {
    const out = speechWindows(
      [
        { start: 1000, end: 1500 },
        { start: 1700, end: 2000 },
        { start: 4000, end: 4200 },
      ],
      6000,
    )
    expect(out).toEqual([
      { start: 850, end: 2150 },
      { start: 3850, end: 4350 },
    ])
  })

  test('clamps to the clip and drops empty or inverted segments', () => {
    const out = speechWindows(
      [
        { start: 0, end: 100 },
        { start: 600, end: 1200 },
        { start: 5000, end: 5000 },
        { start: 800, end: 700 },
      ],
      1000,
    )
    expect(out).toEqual([{ start: 0, end: 1000 }])
  })

  test('keeps windows disjoint so splicing cannot duplicate audio', () => {
    const out = speechWindows([{ start: 0, end: 400 }], 2000, { padMs: 300, mergeGapMs: 500 })
    expect(out).toEqual([{ start: 0, end: 700 }])
  })
})

describe('spliceWindows', () => {
  test('concatenates whole windows at 16 kHz', () => {
    const pcm = new Float32Array(16000)
    pcm.fill(0.5)
    pcm.fill(0, 2000, 4000)
    const out = spliceWindows(pcm, 16000, [
      { start: 0, end: 250 },
      { start: 250, end: 500 },
    ])
    expect(out.length).toBe(8000)
    expect(out[0]).toBe(0.5)
  })

  test('skips windows outside the clip', () => {
    const pcm = new Float32Array(1600)
    expect(spliceWindows(pcm, 16000, [{ start: 500, end: 900 }]).length).toBe(0)
  })
})

describe('spokenMs', () => {
  test('sums only the unpadded speech', () => {
    expect(
      spokenMs([
        { start: 10, end: 60 },
        { start: 200, end: 260 },
      ]),
    ).toBe(110)
  })
})

describe('encodeWav', () => {
  test('writes a mono 16-bit header the gateway can decode', async () => {
    const blob = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000)
    expect(blob.type).toBe('audio/wav')
    const view = new DataView(await blob.arrayBuffer())
    const ascii = (at: number, len: number) =>
      new TextDecoder().decode(new Uint8Array(view.buffer, at, len))
    expect(ascii(0, 4)).toBe('RIFF')
    expect(ascii(8, 4)).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(8)
    expect(view.getInt16(44, true)).toBe(0)
    expect(view.getInt16(46, true)).toBe(0x7fff)
    expect(view.getInt16(48, true)).toBe(-0x8000)
  })
})
