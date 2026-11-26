import { mandarinZhuyin } from '../deck/mandarin'
import { tonelessKey } from '../text/normalize'

const MERGED_INITIALS: Record<string, string> = {
  ㄓ: 'ㄗ',
  ㄔ: 'ㄘ',
  ㄕ: 'ㄙ',
  ㄋ: 'ㄌ',
  ㄈ: 'ㄏ',
}

const LEAD_TONE = '˙'
const TAIL_TONES = ['ˊ', 'ˇ', 'ˋ']

function foldSyllable(syllable: string): string {
  const { lead, body, tail } = splitTones(syllable)
  return lead + foldBody(body) + tail
}

function splitTones(syllable: string): { lead: string; body: string; tail: string } {
  let lead = ''
  let body = syllable
  if (body.startsWith(LEAD_TONE)) {
    lead = LEAD_TONE
    body = body.slice(1)
  }
  const last = body.slice(-1)
  if (!TAIL_TONES.includes(last)) return { lead, body, tail: '' }
  return { lead, body: body.slice(0, -1), tail: last }
}

function foldBody(body: string): string {
  const head = body[0]
  const merged = head ? MERGED_INITIALS[head] : undefined
  if (merged) body = merged + body.slice(1)
  if (body.endsWith('ㄥ')) {
    const stem = body.slice(0, -1)
    if (!stem.endsWith('ㄨ') && !stem.endsWith('ㄩ')) body = stem + 'ㄣ'
  }
  return body
}

export function foldZhuyin(zhuyin: string): string {
  return zhuyin.split(/\s+/).map(foldSyllable).join(' ')
}

export function charSound(ch: string): string | undefined {
  const zhuyin = mandarinZhuyin(ch)
  return zhuyin ? foldZhuyin(zhuyin) : undefined
}

export function soundAlike(a: string, b: string): boolean {
  if (a === b) return true
  const key = charSound(a)
  return key !== undefined && key === charSound(b)
}

export function foldedSound(text: string): string {
  let out = ''
  for (const ch of tonelessKey(text)) out += charSound(ch) ?? ch
  return out
}

export function sameSounds(a: string, b: string): boolean {
  const key = foldedSound(a)
  return key.length > 0 && key === foldedSound(b)
}
