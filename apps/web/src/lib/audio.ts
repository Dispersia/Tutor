export interface Segment {
  start: number
  end: number
}

export interface WindowOptions {
  mergeGapMs?: number
  padMs?: number
}

const WINDOW_DEFAULTS = { mergeGapMs: 400, padMs: 150 }

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
    if (last && seg.start - last.end <= mergeGapMs) last.end = Math.max(last.end, seg.end)
    else out.push({ ...seg })
  }
  return out
}

export function spokenMs(segments: Segment[]): number {
  return segments.reduce((n, s) => n + Math.max(0, s.end - s.start), 0)
}

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

function spansOf(windows: Segment[], perMs: number, length: number) {
  return windows
    .map((w) => ({
      from: Math.max(0, Math.round(w.start * perMs)),
      to: Math.min(length, Math.round(w.end * perMs)),
    }))
    .filter((s) => s.to > s.from)
}

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
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples * 2, true)
}

function writeSamples(view: DataView, pcm: Float32Array): void {
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]!))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
}
