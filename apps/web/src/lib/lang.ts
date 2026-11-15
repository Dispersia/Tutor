/**
 * Language hints for the platform (docs/DESIGN.md §14.2).
 *
 * No browser exposes an API to switch the OS keyboard / input method, so the
 * tutor cannot *force* the Japanese IME to open for a Japanese card. What it can
 * do is label each element with the language it holds: `lang` on a field feeds
 * spellcheck, font fallback and — on some Android keyboards — a best-effort IME
 * nudge. Everything here is a hint, never a guarantee.
 */

/**
 * HTML `lang` tag for an app language code. Chinese resolves to a script variant
 * because the two render different glyphs; it defaults to Traditional, the app's
 * own default (see `generate.ts`).
 */
export function htmlLang(lang: string | null | undefined, variant?: string): string | undefined {
  if (!lang) return undefined
  if (lang === 'zh') return variant === 'simplified' ? 'zh-Hans' : 'zh-Hant'
  if (lang === 'yue') return 'zh-Hant-HK'
  return lang
}

/** The attributes that tell the platform a field is free text in `lang`. */
export interface TypingAttrs {
  lang?: string
  inputmode: 'text'
  enterkeyhint: 'go' | 'done' | 'next'
  autocomplete: 'off'
  autocorrect: 'off'
  autocapitalize: 'off'
  spellcheck: false
}

/**
 * Best-effort hints for a *typing* field. Spread onto an `<input>` / `<textarea>`:
 * `spellcheck` is off so an English dictionary doesn't paint every kana red, and
 * the wrong-language suggestion popups stay away.
 */
export function typingAttrs(
  lang: string | null | undefined,
  opts: { variant?: string; enter?: 'go' | 'done' | 'next' } = {},
): TypingAttrs {
  return {
    lang: htmlLang(lang, opts.variant),
    inputmode: 'text',
    enterkeyhint: opts.enter ?? 'go',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'off',
    spellcheck: false,
  }
}
