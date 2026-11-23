import readings from './mandarin-readings.txt'

let cached: Map<string, string> | undefined

function table(): Map<string, string> {
  if (cached) return cached
  const map = new Map<string, string>()
  for (const line of readings.split('\n')) {
    if (!line) continue
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    map.set(line.slice(0, tab), line.slice(tab + 1))
  }
  return (cached = map)
}

export function mandarinZhuyin(word: string): string | undefined {
  if (!word) return undefined
  return table().get(word)
}

let maxKeyLength = 0

export function mandarinSentenceZhuyin(text: string): string | undefined {
  if (!text) return undefined
  const t = table()
  if (maxKeyLength === 0)
    for (const key of t.keys()) maxKeyLength = Math.max(maxKeyLength, key.length)
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    const match = matchAt(t, text, i)
    if (!match) {
      i++
      continue
    }
    out.push(match.reading)
    i += match.length
  }
  return out.length ? out.join(' ') : undefined
}

function matchAt(
  t: Map<string, string>,
  text: string,
  i: number,
): { reading: string; length: number } | undefined {
  for (let len = Math.min(maxKeyLength, text.length - i); len >= 1; len--) {
    const reading = t.get(text.slice(i, i + len))
    if (reading) return { reading, length: len }
  }
  return undefined
}
