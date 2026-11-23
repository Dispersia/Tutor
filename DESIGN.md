---
name: tutor
description: A local-first, game-flavoured language tutor — Nightforge: a cool slate ground, one indigo action, muted category hues, and a self-hosted type system that covers every target script.
colors:
  ink-950: 'oklch(0.175 0.014 258)'
  ink-900: 'oklch(0.21 0.016 258)'
  ink-850: 'oklch(0.242 0.018 258)'
  ink-800: 'oklch(0.288 0.02 258)'
  ink-700: 'oklch(0.358 0.022 258)'
  ink-600: 'oklch(0.465 0.022 258)'
  ink-500: 'oklch(0.59 0.02 258)'
  ink-400: 'oklch(0.7 0.018 258)'
  ink-300: 'oklch(0.81 0.014 258)'
  ink-200: 'oklch(0.9 0.01 258)'
  ink-100: 'oklch(0.955 0.007 258)'
  gold-200: 'oklch(0.92 0.08 95)'
  gold-300: 'oklch(0.85 0.13 93)'
  gold-400: 'oklch(0.78 0.145 90)'
  gold-500: 'oklch(0.68 0.135 88)'
  gold-600: 'oklch(0.56 0.11 86)'
  seal-300: 'oklch(0.79 0.11 268)'
  seal-400: 'oklch(0.67 0.16 268)'
  seal-500: 'oklch(0.57 0.16 267)'
  seal-600: 'oklch(0.47 0.15 266)'
  jade-300: 'oklch(0.82 0.09 158)'
  jade-400: 'oklch(0.73 0.1 158)'
  jade-500: 'oklch(0.63 0.1 156)'
  jade-950: 'oklch(0.24 0.04 158)'
  brass-300: 'oklch(0.86 0.11 80)'
  brass-400: 'oklch(0.79 0.125 78)'
  brass-500: 'oklch(0.69 0.12 76)'
  brass-950: 'oklch(0.26 0.045 76)'
  violet-300: 'oklch(0.8 0.09 300)'
  violet-400: 'oklch(0.71 0.1 300)'
  violet-500: 'oklch(0.61 0.1 300)'
  ember-300: 'oklch(0.78 0.14 20)'
  ember-400: 'oklch(0.67 0.2 22)'
  ember-500: 'oklch(0.59 0.2 21)'
  ember-600: 'oklch(0.51 0.18 20)'
  ember-800: 'oklch(0.33 0.1 20)'
  ember-950: 'oklch(0.21 0.05 20)'
  azure-300: 'oklch(0.82 0.09 245)'
  azure-400: 'oklch(0.73 0.1 245)'
  azure-500: 'oklch(0.63 0.1 245)'
typography:
  display:
    fontFamily: "'Space Grotesk', 'Songti SC', 'Songti TC', STSong, 'Noto Serif CJK SC', 'Noto Serif SC', 'Noto Serif CJK TC', 'Noto Serif TC', 'Yu Mincho', 'Hiragino Mincho ProN', 'Noto Serif CJK JP', 'Noto Serif JP', 'Nanum Myeongjo', 'Noto Serif CJK KR', 'Noto Serif KR', serif"
    letterSpacing: '-0.01em'
  body:
    fontFamily: "'Rubik', system-ui, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'PingFang TC', 'Hiragino Sans', 'Yu Gothic', 'Noto Sans CJK SC', 'Noto Sans SC', 'Noto Sans CJK TC', 'Noto Sans TC', 'Noto Sans CJK JP', 'Noto Sans JP', 'Noto Sans CJK KR', 'Noto Sans KR', sans-serif"
    fontSize: '1rem'
  headline:
    fontSize: '1.85rem'
    fontWeight: 700
  title:
    fontSize: '1rem'
    fontWeight: 600
  small:
    fontSize: '0.92rem'
    fontWeight: 400
  label:
    fontSize: '0.82rem'
    letterSpacing: '0.16em'
    fontWeight: 600
rounded:
  panel: '14px'
  button: '10px'
  field: '9px'
  tile: '12px'
  chip: '999px'
  bar: '999px'
spacing:
  xs: '0.25rem'
  sm: '0.5rem'
  md: '0.75rem'
  lg: '1rem'
components:
  button-primary:
    backgroundColor: '{colors.seal-400}'
    textColor: '{colors.ink-950}'
    rounded: '{rounded.button}'
    padding: '0.6rem 1rem'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-200}'
    rounded: '{rounded.button}'
    padding: '0.6rem 1rem'
  button-gold:
    backgroundColor: '{colors.gold-300}'
    textColor: '{colors.ink-950}'
    rounded: '{rounded.button}'
    padding: '0.6rem 1rem'
  panel:
    backgroundColor: '{colors.ink-850}'
    textColor: '{colors.ink-200}'
    rounded: '{rounded.panel}'
    padding: '1rem'
  stat-card:
    backgroundColor: '{colors.ink-850}'
    rounded: '{rounded.tile}'
    padding: '0.75rem'
  level-badge:
    backgroundColor: '{colors.ink-900}'
    textColor: '{colors.gold-300}'
    rounded: '7px'
    padding: '0.12rem 0.4rem'
---

# Design System: tutor — Nightforge

## Overview

**Creative North Star: "Nightforge."**

A game you actually want to open every day. The room is **graphite** — a neutral
dark with a cool blue cast, never warm brown — and the interface is **flat**:
colour, borders and type do the work, and nothing glows.

One **indigo** carries the single action that moves the session forward.
Everything the player earned is set in **gold**. The professions keep four muted
category hues — jade grows, brass is the artisan, violet is support, ember is
combat — and azure is the academy. Colour is a role, never a mood.

The signature is the **character cell**: every studied glyph sits on a ruled,
accent-tinted square, and the language is always set in a serif that matches its
script.

**Key characteristics:**

- Cool slate ladder (`ink-950` → `ink-100`), no warm cast, no gradients
- One indigo action; gold for earned figures; four muted category hues
- Generous radii (10–14px), hairline borders, one soft shadow — flat, not skeuomorphic
- Mobile-first single column with a bottom tab bar; desktop opens into a rail + wider spread
- A self-hosted type system that covers Latin, CJK, kana, Hangul, Bopomofo and Cyrillic

## Colors

### Primary

- **Seal Indigo** (`oklch(0.67 0.16 268)`): the action colour. Primary buttons,
  the active tab, the level stamp. The one thing that moves the session forward.

### Secondary

- **Gold** (`oklch(0.85 0.13 93)`): the reward colour. Every number the
  player earned — XP, streak, ranks, currency, the level figure.

### Tertiary

- **Jade** (`oklch(0.73 0.1 158)`): what grows — daily goal, player health, gathering, success.
- **Brass** (`oklch(0.79 0.125 78)`): artisan, streak, coins, warnings.
- **Azure** (`oklch(0.73 0.1 245)`): the academy — levels, chat, the next word.
- **Violet** (`oklch(0.71 0.1 300)`): support and talents.
- **Ember** (`oklch(0.66 0.14 25)`): combat, damage, danger.

### Neutral

- **Ink** (`ink-950` → `ink-100`): the graphite ground and the surface ladder
  above it. Depth is one step on this ladder plus a hairline border.

### Named Rules

**The One Accent Rule.** A surface carries exactly one accent, set through
`--accent` (`accentStyle(color)`); tints and borders derive from it with
`color-mix`. Two accents in one panel is a bug, not a flourish.

**The Muted Rule.** Accents are deliberately desaturated (chroma ≈ 0.09–0.15) so
the hues sit beside each other instead of shouting across the screen.

**The Flat Rule.** No gradients, no glows, no glassmorphism. Separation comes
from the surface ladder, a 1px border and one soft shadow.

**The Cell Holds The Word Rule.** The character cell is reserved for language.

## Typography

**Display:** Space Grotesk, self-hosted, with a native CJK serif behind it
(`Songti SC`, `Noto Serif CJK SC`, … , `Noto Serif CJK KR`).
**Body:** Rubik, self-hosted, with a native CJK sans behind it.

**Character.** A clean grotesque carries the things a player is proud of — names,
headings, level numerals, button labels — and a clean sans carries everything
read quickly. Language content is the exception: it is always set in a serif that
matches its script, so a Japanese kanji never takes a Chinese glyph shape and
Zhuyin finds a Traditional-Chinese face. Latin is never a system default and CJK
is never a guess.

### Hierarchy

- **Display** (600–700, 1.85rem+, `-0.01em`): screen titles, the account handle,
  level numerals, every large stat. Always tabular numerals.
- **Headline** (600, 1.1–1.5rem): section titles.
- **Title** (500–600, 1–1.05rem): row names, exercise prompts.
- **Body** (400, 0.92–1rem, 1.5): instructions, chat text, prompts.
- **Label** (600, 0.82rem, `0.16em` tracking, uppercase): row labels, field labels.

### Named Rules

**The Serif-For-Earned Rule.** If it is a number the player earned, it is set in
the display face with `font-variant-numeric: tabular-nums`. Sentences are sans.

**The Caps-Tracking Rule.** Uppercase is reserved for the tracked label and button
copy, and always carries at least `0.06em` of letter-spacing.

**The CJK-Leading Rule.** CJK glyphs fill the em box, so language text takes a
looser leading (≥1.3 for display, ≥1.5 for body) and **zero** tracking.

## Layout

One column, mobile first. Content sits in a centered `max-width: 42rem` column
with 1rem side padding and safe-area insets. Pages open with a header carrying a
1px rule beneath it. Density is high but never cramped.

From `min-width: 1024px` the column widens and a page may open into a spread —
two columns set side by side (Home, Skills, Learn, Skills detail) — while a
focused task (the drill, a conversation) stays in a narrower centered measure.

Navigation is two fixed surfaces on a phone: a **title bar** carrying the app mark
and the account stamp, and three equal tabs in the thumb zone (**Home, Skills,
Learn**), both safe-area padded and blurred over the content. On desktop both
bars give way to a persistent **left rail** — the wordmark, the three
destinations, a hairline, then Chat / Bank / History / Settings, with the member
stamp and Sign out at the foot.

## Elevation & Depth

Flat by construction. There are no gradients and no glows. Depth is tonal: a
panel is one step lighter than the page (`ink-850` on `ink-950`), a header is one
step lighter than its panel (`ink-800`), and a 1px `ink-700` border separates
them. A single soft shadow (`0 1px 2px`) lifts a panel off the page.

**The Flat-By-Default Rule.** If a surface seems to float, it is wrong; lower its
fill instead of adding a shadow.

## Shapes

Soft rectangles with a generous radius scale: **14px** for panels, **12px** for
tiles and the character cell, **10px** for buttons, **9px** for input fields, and
a full pill for chips and progress bars.

The signature geometry is the **character cell**: a square ruled with faint cross
guides, accent-tinted, holding one character. It appears wherever the app shows
the language and is the system's game tell.

## Components

### Buttons

- **Shape:** 10px radius, inline-flex, `0.45rem` icon gap, `0.6rem × 1rem`
  padding, `0.92rem` text at weight 600, uppercase with `0.06em` tracking, and a
  44px minimum height for touch.
- **Primary:** Seal Indigo fill, near-black text — the one action that moves forward.
- **Gold:** Gold fill — spending, claiming, rewarding.
- **Ghost:** transparent fill, `ink-600` border, `ink-200` text.
- **Hover:** `brightness(1.08)`; active translates down 1px.
- **Disabled:** drops to a neutral surface with `ink-400` text — never a faded
  smear of its own colour.

### Chips

- Pill, accent-tinted fill (`color-mix` 12% accent into `ink-850`), 1px accent
  border at 40%, accent-tinted text at 70% toward `ink-100`, `0.82rem` text.

### Cards / Containers

- **Radius:** 14px panels, 12px tiles.
- **Background:** `ink-850` for panels; accent-tinted `ink-850` (9% accent) for
  panels that belong to a section; `ink-800` for panel headers.
- **Border:** 1px `ink-700`; accent panels mix the accent 40% into the border.

### Inputs / Fields

- `ink-900` fill, 1px `ink-600` border, 9px radius, generous padding; focus
  shifts the border to Seal Indigo with a 3px indigo ring.

### Signature Components

- **Character cell:** an accent-tinted square with faint cross guides, holding one
  character in the display face — a serif that matches the glyph's script.
- **Level seal:** a circular stamp, 2px indigo border, indigo-tinted fill, display
  numeral with a tracked `LEVEL` label.
- **Rank badge:** pill, `ink-900` fill, 1px gold border at 55%, gold numerals.
- **Profile stamp:** a small square holding the member's initial; indigo when its
  menu is open.
- **Progress bar:** 9px tall, pill, `ink-900` groove with a 1px `ink-700` border,
  fill in the panel's accent.

## Do's and Don'ts

### Do

- **Do** assign colour through `--accent` per surface, so tints and borders derive
  from one hue.
- **Do** set earned numbers in the display face with tabular figures, brass gold
  when they are XP, streak, rank or currency.
- **Do** keep the character cell for language only, and Seal Indigo for the one
  forward action.
- **Do** convey depth with one lightness step plus a 1px hairline.
- **Do** keep colour semantic: jade grows, brass earns, azure is the academy,
  violet is support, ember is combat.
- **Do** set language text in a serif that matches its script, with CJK leading
  and zero tracking.
- **Do** draw icons as one stroke and weight.

### Don't

- **Don't** add gradients, glows, coloured drop shadows, or glassmorphism.
- **Don't** put two accents in one panel, or use gold as a fill behind body text.
- **Don't** set body copy in the display face, or uppercase anything without
  `0.06em` of tracking.
- **Don't** apply negative tracking to CJK, or Latin leading to CJK display text.
- **Don't** use the character cell as a generic container.
- **Don't** let a disabled control keep its accent colour.
