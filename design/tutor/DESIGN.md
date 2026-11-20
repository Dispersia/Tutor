---
name: tutor
description: A game-flavoured, local-first language tutor — flat graphite ground, one ember action, gold figures for everything earned, and a ruled character cell holding the word.
colors:
  bg: 'oklch(0.16 0.006 258)'
  bg-deep: 'oklch(0.124 0.006 258)'
  surface: 'oklch(0.226 0.008 258)'
  surface-2: 'oklch(0.272 0.009 258)'
  surface-3: 'oklch(0.32 0.009 258)'
  border: 'oklch(0.34 0.01 258)'
  border-hi: 'oklch(0.46 0.012 258)'
  fg: 'oklch(0.93 0.004 258)'
  muted: 'oklch(0.77 0.008 258)'
  faint: 'oklch(0.68 0.008 258)'
  ink: 'oklch(0.16 0.006 258)'
  focus: 'oklch(0.86 0.012 258)'
  ember: 'oklch(0.7 0.145 52)'
  ember-hi: 'oklch(0.79 0.125 58)'
  ember-lo: 'oklch(0.56 0.13 48)'
  gold: 'oklch(0.8 0.105 88)'
  gold-lo: 'oklch(0.66 0.08 84)'
  jade: 'oklch(0.73 0.1 158)'
  amber: 'oklch(0.76 0.1 68)'
  violet: 'oklch(0.71 0.1 300)'
  crimson: 'oklch(0.66 0.14 25)'
  azure: 'oklch(0.73 0.1 245)'
typography:
  display:
    fontFamily: "'Space Grotesk', 'Noto Serif', <CJK serif stack>, serif"
    letterSpacing: '-0.01em'
  body:
    fontFamily: "'Rubik', <CJK sans stack>, sans-serif"
    fontSize: '0.95rem'
    lineHeight: '1.5'
  page-title:
    fontSize: '1.85rem'
    fontWeight: 700
  card-title:
    fontSize: '1.05rem'
    fontWeight: 600
  label:
    fontSize: '0.82rem'
    fontWeight: 600
    letterSpacing: '0.16em'
  floor:
    fontSize: '0.82rem'
rounded:
  panel: '16px'
  card: '12px'
  button: '10px'
  input: '9px'
  pill: '999px'
components:
  panel:
    backgroundColor: '{colors.surface}'
    border: '1px solid {colors.border}'
    rounded: '{rounded.panel}'
  panel-tint:
    backgroundColor: 'color-mix(in oklab, var(--c) 9%, {colors.surface})'
    borderColor: 'color-mix(in oklab, var(--c) 40%, {colors.border})'
  button-primary:
    backgroundColor: '{colors.ember}'
    textColor: '{colors.ink}'
    rounded: '{rounded.button}'
  button-ghost:
    backgroundColor: 'transparent'
    borderColor: '{colors.border-hi}'
    rounded: '{rounded.button}'
  tile:
    backgroundColor: 'color-mix(in oklab, var(--c) 14%, {colors.surface})'
    borderColor: 'color-mix(in oklab, var(--c) 60%, {colors.border})'
    rounded: '{rounded.card}'
  character-cell:
    backgroundColor: 'color-mix(in oklab, var(--c) 10%, {colors.surface})'
    borderColor: 'color-mix(in oklab, var(--c) 65%, {colors.border})'
    rounded: '{rounded.card}'
---

# Design System: Tutor

## Overview

**Creative North Star: "The Working Forge."**

A household shares one self-hosted language tutor. The room is dark and neutral — a flat
graphite ladder from `bg` to `border-hi`, no gradients and no glows — and the language
lives in a **ruled character cell**: a square with faint cross guides at 12% inset holding
the word under study. Colour is data, never mood: one **ember** marks the single action
that moves the session forward, **gold** figures every number the player earned, and
**jade, amber, violet, crimson and azure** mean gathering, artisan, support, combat and the
academy everywhere they appear. A correct drill lands a strike and powers an idle rig, so
the page has to look like a machine that keeps running while you are away.

This is a replacement of the earlier "Lexicon" system, not a refinement of it: the ink
ladder, the vermilion seal, the brass ledger and the ruled serif entries are gone. What
survives is the discipline — one accent per panel, tabular figures, a quarter-second motion
budget — carried into a flatter, more instrument-like register.

**Key characteristics**

- Flat neutral graphite, six steps, one soft shadow, no gradients anywhere
- One ember action per view; everything else is ghost or a text link
- One accent per panel, set with `--c`; tints and borders derive from it with `color-mix`
- The character cell, drawn with hairlines rather than a background image
- Earned numbers in gold, display face, `tabular-nums`
- Self-hosted type with a regional CJK fallback chain behind it

## Colors

Colour is a role, not decoration. Every hue has exactly one meaning and keeps it.

| Token | Role |
| --- | --- |
| `--bg`, `--bg-deep` | page ground, and the chrome: top bar, bottom tabs, rail, bar grooves |
| `--surface`, `--surface-2`, `--surface-3` | panels, raised elements, skeletons |
| `--border`, `--border-hi` | hairline rules, and the outline of anything interactive |
| `--fg`, `--muted`, `--faint` | primary, secondary and tertiary text |
| `--ink` | text on a bright fill (the ember button) |
| `--focus` | the focus ring — a neutral bright hairline, ≥9:1 on every surface |
| `--ember` | **the** one forward action; `ember-hi` for active nav, `ember-lo` for its border |
| `--gold` | every number the player earned |
| `--jade` | gathering, growth, health, success |
| `--amber` | artisan, streaks, coins |
| `--violet` | support, talents |
| `--crimson` | combat, danger, errors |
| `--azure` | the academy, arcane, chat, decks |

Accents are deliberately muted (chroma 0.09–0.15) and are never used as a fill behind body
copy. **The One Accent Rule:** a panel sets `--c` once and every tint, border, bar, chip and
icon in its frame derives from that one hue; two *panel* accents in one panel is a bug. The
rule governs the panel's ambient tint, not the data inside it — a rig row, a tile or a chip
that belongs to another profession speaks in that profession's hue, every earned figure is
gold, and the single ember action is always exempt. A banner inside a panel takes the panel's
own accent, so a warn banner lives in an amber panel and a success banner in a jade one.

**The Flat Rule.** Depth is a lightness step plus a hairline. There are no gradients, no
glows and no glass. The only translucent surface is the sheet scrim.

## Typography

**Display:** Space Grotesk (latin, variable, self-hosted), then Noto Serif for Cyrillic,
then a native CJK serif chain — `Songti SC/TC`, `Noto Serif CJK/SC/TC/JP/KR`,
`Yu Mincho`, `Hiragino Mincho ProN`, `Nanum Myeongjo`.
**Body:** Rubik (latin, variable, self-hosted), then a native CJK sans chain — `PingFang
SC/TC`, `Hiragino Sans`, `Yu Gothic`, `Noto Sans CJK/SC/TC/JP/KR`, `Malgun Gothic`.

Both chains are re-ordered per language: `:lang(ja)` puts the Japanese faces first,
`:lang(ko)` the Korean, `:lang(zh-Hant)` the Traditional Chinese. Japanese kanji therefore
never take Chinese glyph shapes. Every language-bearing node carries its `lang`.

| Role | Size | Notes |
| --- | --- | --- |
| Page title | 1.85rem / 700 | display face, −0.01em tracking |
| Card title | 1.05rem / 600 | display face |
| Body | 0.95rem / 400 | body face, 1.5 leading |
| Secondary | 0.9rem | `--muted` |
| Label | 0.82rem / 600 | uppercase, 0.16em tracking |
| Floor | 0.82rem | nothing renders smaller |

**The Serif-For-Earned Rule.** Anything the player earned is set in the display face with
`font-variant-numeric: tabular-nums`, in gold. Sentences are body-face and never uppercase.
**The CJK Rule.** Language text takes the display face at 1.3 leading and **zero** tracking,
at every size, including inside a button.

## Layout

Mobile first. One column, max-width 46rem, 14px gutters, safe-area insets.

- **Phone.** A slim top bar carries the wordmark and the account stamp only; level, gold and
  streak live on the page. Three equal tabs — Home, Skills, Learn — sit in the thumb zone.
- **Desktop (≥1024px).** Both bars disappear. A fixed 16rem left rail carries the wordmark,
  the three destinations, a hairline, then Chat / Bank / History / Settings, with the
  account at the foot. Content widens to 52rem with 26px gutters.
- **Wide (≥1280px).** A page may open into two columns: the activity map beside the earned
  figures, or the deck builder beside the decks.

Density comes from ruled rows separated by 1px rules rather than a grid of cards. A row
carries 12px of vertical padding; a panel 14px.

## Components

- **Panel.** `--surface`, 1px `--border`, 16px radius, the one soft shadow, 14px padding.
  `.panel--tint` mixes 9% of `--c` into the fill and 40% into the border.
- **Ribbon.** A 10px rotated square in `--c` plus an uppercase tracked label, with an
  optional `.ribbon__tag` count on the right in `--c`.
- **Button.** 10px radius, min-height 44px, display face 600, uppercase, 0.06em tracking.
  Primary is `--ember` with `--ink` text; ghost is transparent with a `--border-hi` outline.
  Hover is `brightness(1.08)` (or a surface fill for ghost), active translates down 1px.
  Disabled drops to a `--surface` fill, a `--border` hairline and `--faint` text.
- **Tile.** A 44px square, 12px radius, `color-mix(--c 14%, --surface)` fill, a `--c` border,
  an icon in `--c`.
- **Character cell.** The signature: a square with `color-mix(--c 10%, --surface)`, a 1px
  `--c` border, cross guides drawn as two hairlines at 12% inset (no gradient), the glyph in
  the display face at 2rem, the native reading at 0.9rem beneath it. It grows sideways for
  multi-character words and never clips.
- **Bar.** A 10px (8px slim) pill groove in `--bg-deep` with a 1px border; the fill is a flat
  `--c` and animates to 0.4s.
- **Chip.** A pill, `--c`-tinted, for items and costs; `.chip--plain` for a neutral tag.
- **Level medallion.** A circle, `--surface-2` fill, a 2px `--gold` ring, the numeral in the
  display face.
- **Banner.** Info / success / warn / error, tinted from `--azure` / `--jade` / `--amber` /
  `--crimson`; the glyph is lifted toward `--fg` so it clears 4.5:1 on its own tint.
- **Sheet.** A bottom sheet on phones, a centred 640px dialog from 720px up, over a scrim.
  Focus moves in on open, Tab is trapped, `Escape` closes, focus is returned on close.
- **Rig row.** The idle tell: a tile, the action name, then in `--c` micro-type a gear glyph,
  the live rate (`1 / 7s`) and the run clock (`48m left`), with the run bar beneath. When the
  run is over the row reads `still` in `--faint`.

## Do's and Don'ts

**Do** assign colour through `--c` so a panel's tints and borders derive from one hue.
**Do** set earned numbers in gold, display face, tabular. **Do** keep the character cell for
language only. **Do** convey depth with one lightness step plus a hairline. **Do** draw
every icon in one stroke and weight, and hide it from assistive tech.

**Don't** add gradients, glows, coloured shadows or glass. **Don't** put two accents in one
panel, or gold behind body copy. **Don't** use a second solid ember button in a viewport, or
repeat the primary's copy on a secondary entry. **Don't** set body copy in the display face,
or uppercase anything except a tracked label. **Don't** use emoji as icons, or
`white-space: nowrap` to squeeze text into a neighbour.

## Verification

Contrast was computed from the pinned oklch values rather than eyeballed: every text pair
clears 4.5:1 and every icon and border clears 3:1 in default, hover, focus and active
states. No horizontal scroll at 360 / 390 / 430 / 600 / 768 / 1024 / 1440 / 1920. No element
clips its own text at 390 or 1440. Nothing renders below 13px. The self-hosted fonts were
checked with no system CJK, kana, Hangul, Bopomofo or Cyrillic font available.
