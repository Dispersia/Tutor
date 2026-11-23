/** Deterministic PRNG and sentence normalisation for the sentence drills. */

/** Deterministic PRNG so the same card always yields the same sentence. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Normalises a built/typed sentence for comparison (ignore spaces + punctuation). */
export function normalizeSentence(s: string): string {
  return s.replace(/[\s.,!?。，！？、；：；'"]/g, '').trim()
}
