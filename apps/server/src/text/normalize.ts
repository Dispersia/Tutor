/**
 * Text normalisers: the keys two strings are compared by.
 *
 * They are deliberately separate functions — each call site compares a
 * different thing, and what one of them ignores another must keep. Pick by what
 * has to survive:
 *
 * | function           | case    | marks (tones, dakuten) | width (NFKC) | strips                         |
 * | ------------------ | ------- | ---------------------- | ------------ | ------------------------------ |
 * | `bareText`         | lowered | kept                   | kept         | whitespace, `\p{P}`, `\p{S}`   |
 * | `wordKey`          | lowered | kept                   | folded       | whitespace, `\p{P}`, `\p{S}`   |
 * | `lettersAndDigits` | lowered | dropped (`\p{M}`)      | folded       | everything but `\p{L}`/`\p{N}` |
 * | `sentenceKey`      | kept    | kept                   | kept         | whitespace + a short list      |
 * | `answerKey`        | lowered | kept                   | folded       | whitespace + a short list      |
 * | `tonelessKey`      | lowered | dropped (U+0300–036F)  | decomposed   | whitespace + a short list      |
 */

/**
 * Whitespace, punctuation (`\p{P}`) and symbols (`\p{S}`) removed, then
 * lower-cased — so “你好。” and “你好” compare equal. Nothing is folded: a
 * full-width letter, a tone mark and a dakuten all survive.
 */
export const bareText = (s: string): string => s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()

/**
 * {@link bareText} after NFKC, so width and compatibility forms fold too
 * (`ＡＢＣ` = `abc`, half-width ｶﾞ = ガ). How a requested word and the word a
 * model handed back are matched.
 */
export const wordKey = (s: string): string => bareText(s.normalize('NFKC'))

/**
 * Letters and digits only (`\p{L}`, `\p{N}`), NFKC-folded and lower-cased: what
 * was said, not how it was written. Stricter than {@link wordKey} — everything
 * else goes, including combining marks and characters that are neither
 * punctuation nor symbols.
 */
export const lettersAndDigits = (s: string): string =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

/**
 * A built or typed sentence for an exact comparison: whitespace and sentence
 * punctuation (`. , ! ? 。 ， ！ ？ 、 ； ： ' "`) removed. **Case is kept** and
 * nothing else is stripped, so a hyphen or a bracket still counts.
 */
export const sentenceKey = (s: string): string => s.replace(/[\s.,!?。，！？、；：'"]/g, '').trim()

/** Lower-case, drop whitespace (incl. ideographic) and answer punctuation. */
function squash(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[.,!?;:'"“”‘’。，！？、；：（）()[\]…·-]/g, '')
}

/**
 * A typed answer with its diacritics intact: NFKC, lower-cased, whitespace and
 * common punctuation (ASCII + CJK, brackets, hyphen, ellipsis) removed. `año` is
 * not `ano`, が is not か.
 */
export const answerKey = (s: string): string => squash(s.normalize('NFKC'))

/**
 * {@link answerKey} that also folds diacritics: NFKD, then the combining marks
 * U+0300–U+036F are dropped, so `nǐ hǎo` = `ni hao`. Only right for a
 * romanisation, where a tone mark is optional. Kana voicing marks
 * (U+3099/U+309A) are outside that range and survive, decomposed.
 */
export const tonelessKey = (s: string): string =>
  squash(s.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''))
