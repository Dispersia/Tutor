export function htmlLang(lang: string | null | undefined, variant?: string): string | undefined {
  if (!lang) return undefined
  if (lang === 'zh') return variant === 'simplified' ? 'zh-Hans' : 'zh-Hant'
  if (lang === 'yue') return 'zh-Hant-HK'
  return lang
}

export interface TypingAttrs {
  lang?: string
  inputmode: 'text'
  enterkeyhint: 'go' | 'done' | 'next'
  autocomplete: 'off'
  autocorrect: 'off'
  autocapitalize: 'off'
  spellcheck: false
}

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
