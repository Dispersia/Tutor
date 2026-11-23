/**
 * Pure audio helpers for the mic pipeline (no DOM, so it is unit-testable).
 *
 * Silero VAD reports where the speech is, in milliseconds; these functions turn
 * those windows into one clipped, spliced PCM buffer and then into a 16 kHz WAV —
 * so the ASR never sees the silence around (or between) the utterances.
 */

export interface Segment {
  /** Start of the window, in ms from the start of the clip. */
  start: number
  /** End of the window, in ms. */
  end: number
}

export interface WindowOptions {
  /** Silence shorter than this stays inside one window instead of cutting the clip. */
  mergeGapMs?: number
  /** Air kept on both sides, so an onset or a final consonant is never clipped. */
  padMs?: number
}

const WINDOW_DEFAULTS = { mergeGapMs: 400, padMs: 150 }

/**
 * Pads every speech window, merges the ones that end up adjacent, and clamps them
 * to the clip. Returned in order, never overlapping, so splicing them back
 * together yields a single monotonic buffer.
 */
export function speechWindows(
  segments: Segment[],
  durationMs: number,
  opts: WindowOptions = {},
): Segment[] {
  const padded = paddedSegments(segments, durationMs, opts.padMs ?? WINDOW_DEFAULTS.padMs)
  return mergeWindows(padded, opts.mergeGapMs ?? WINDOW_DEFAULTS.mergeGapMs)
}

function paddedSegments(segments: Segment[], durationMs: number, padMs: number): Segment[] {
  return segments
    .filter((s) => s.end > s.start)
    .map((s) => ({
      start: Math.max(0, s.start - padMs),
      end: Math.min(durationMs, s.end + padMs),
    }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start)
}

function mergeWindows(padded: Segment[], mergeGapMs: number): Segment[] {
  const out: Segment[] = []
  for (const seg of padded) {
    const last = out.at(-1)
    // A padded window can overlap its neighbour even when the raw speech did not.
    if (last && seg.start - last.end <= mergeGapMs) last.end = Math.max(last.end, seg.end)
    else out.push({ ...seg })
  }
  return out
}

/** Milliseconds of speech in the raw (unpadded) segments. */
export function spokenMs(segments: Segment[]): number {
  return segments.reduce((n, s) => n + Math.max(0, s.end - s.start), 0)
}

/** Concatenates the given windows of `pcm` into one buffer (mono, same rate). */
export function spliceWindows(
  pcm: Float32Array,
  sampleRate: number,
  windows: Segment[],
): Float32Array {
  const spans = spansOf(windows, sampleRate / 1000, pcm.length)
  const out = new Float32Array(spans.reduce((n, s) => n + (s.to - s.from), 0))
  let at = 0
  for (const span of spans) {
    out.set(pcm.subarray(span.from, span.to), at)
    at += span.to - span.from
  }
  return out
}

/** The sample spans a set of ms windows covers, clamped to the buffer. */
function spansOf(windows: Segment[], perMs: number, length: number) {
  return windows
    .map((w) => ({
      from: Math.max(0, Math.round(w.start * perMs)),
      to: Math.min(length, Math.round(w.end * perMs)),
    }))
    .filter((s) => s.to > s.from)
}

/** 16-bit PCM WAV container for mono float samples in [-1, 1]. */
export function encodeWav(pcm: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + pcm.length * 2)
  const view = new DataView(buf)
  writeWavHeader(view, sampleRate, pcm.length)
  writeSamples(view, pcm)
  return new Blob([buf], { type: 'audio/wav' })
}

function writeWavHeader(view: DataView, sampleRate: number, samples: number): void {
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, samples * 2, true)
}

function writeSamples(view: DataView, pcm: Float32Array): void {
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]!))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
}
