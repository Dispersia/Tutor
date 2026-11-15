---
name: tutor
description: A local-first, game-flavoured language tutor for a household — dark slate boards, gold ledger numbers, one saturated accent per panel.
colors:
  night-ink: '#12141b'
  slate-950: '#101218'
  slate-900: '#171a22'
  slate-850: '#1f2330'
  slate-800: '#272c3a'
  slate-700: '#353c4d'
  slate-600: '#454e63'
  slate-500: '#5a657d'
  slate-400: '#8b95aa'
  slate-300: '#bcc4d3'
  chalk: '#e7eaf1'
  ledger-gold-200: '#f6e6ae'
  ledger-gold-300: '#e8c15a'
  ledger-gold-400: '#d9a93c'
  ledger-gold-500: '#b9862a'
  ledger-gold-600: '#8f6620'
  moonlit-blue: '#5b9be0'
  grove-green: '#5cc46a'
  brass-amber: '#e6a83c'
  arcane-violet: '#a97fe0'
  ember-red: '#e05858'
typography:
  display:
    fontFamily: 'Iowan Old Style, Palatino Linotype, Palatino, Georgia, Noto Serif, Times New Roman, serif'
    letterSpacing: '0.01em'
  body:
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif'
  label:
    fontSize: '0.68rem'
    letterSpacing: '0.14em'
    fontWeight: 400
rounded:
  panel: '0.6rem'
  button: '0.5rem'
  chip: '0.4rem'
  field: '0.75rem'
  pill: '999px'
spacing:
  xs: '0.15rem'
  sm: '0.45rem'
  md: '0.9rem'
  lg: '1rem'
components:
  button-primary:
    backgroundColor: '{colors.moonlit-blue}'
    textColor: '#ffffff'
    rounded: '{rounded.button}'
    padding: '0.55rem 0.9rem'
  button-gold:
    backgroundColor: '{colors.ledger-gold-400}'
    textColor: '#2a1d03'
    rounded: '{rounded.button}'
    padding: '0.55rem 0.9rem'
  button-ghost:
    backgroundColor: '{colors.slate-800}'
    textColor: '{colors.slate-300}'
    rounded: '{rounded.button}'
    padding: '0.55rem 0.9rem'
  button-accent:
    backgroundColor: '{colors.moonlit-blue}'
    textColor: '#08111b'
    rounded: '{rounded.button}'
    padding: '0.55rem 0.9rem'
  panel:
    backgroundColor: '{colors.slate-850}'
    textColor: '{colors.chalk}'
    rounded: '{rounded.panel}'
    padding: '0'
  stat-card:
    backgroundColor: '{colors.slate-850}'
    rounded: '{rounded.panel}'
    padding: '0.75rem'
  level-badge:
    backgroundColor: 'rgba(0, 0, 0, 0.25)'
    textColor: '{colors.ledger-gold-300}'
    rounded: '{rounded.chip}'
    padding: '0.1rem 0.35rem'
  nav-item-active:
    backgroundColor: '{colors.slate-800}'
    textColor: '{colors.ledger-gold-300}'
    rounded: '{rounded.button}'
    padding: '0.25rem 0.75rem'
---

# Design System: tutor

## Overview

**Creative North Star: "The Night Academy"**

A game HUD a household actually uses every day. The room is dark: near-black slate
boards, one-pixel ink borders, flat fills, an inset hairline catching light along
the top of every panel. The reward layer is where color lives — a saturated
profession accent tints a card, gold ranks and numbers sit in a serif face, a
progress bar fills in the green of a daily streak. Nothing glows, nothing
gradients, nothing floats.

The game register is carried by **structure and color semantics**, not by novelty:
accent edges, rank badges, progress bars, XP numerals, and emoji confined to the
navigation and celebration moments. The professional register is carried by
**discipline**: one column, one accent per panel, one serif, tabular numbers, and
motion capped at a quarter-second unless it is a bar filling. Fun is allowed to be
loud in hue; it is never allowed to be sloppy in spacing or alignment.

This is a refinement of the incumbent Melvor-flavoured system in
`apps/web/src/app.css`, not a replacement. The household agreed the name, palette
and theme may change later; until then this file is the visual authority.

**Key Characteristics:**

- Dark slate surfaces (`#101218`–`#454e63`), flat, no gradients or glows
- One saturated accent per panel, assigned with a `--accent` custom property
- Iowan Old Style serif for names, headings and every number that matters
- 0.6rem cards with 1px ink borders and an inset 1px top highlight
- Game signals: 3px accent edges, rank badges, progress bars, tier colors
- Mobile-first single column (max 42rem), six-tab bottom navigation

## Colors

A dark neutral ladder with a gold ledger and five saturated semantic accents —
color is data, not decoration.

### Primary

- **Moonlit Blue** (`#5b9be0`): the default `--accent` and the primary action
  color. Arcane/level surfaces, primary buttons, progress that is not tied to
  streak or XP.

### Secondary

- **Ledger Gold** (`#e8c15a`): the reward color. Rank badges, level numbers, XP
  figures, active navigation, the account name in the header. Never a large fill.

### Tertiary

- **Grove Green** (`#5cc46a`): gathering profession, daily goal, player health,
  streak-safe states, consumables.
- **Brass Amber** (`#e6a83c`): artisan profession, streak count, coins.
- **Arcane Violet** (`#a97fe0`): support profession, talent and magic surfaces.
- **Ember Red** (`#e05858`): combat profession, player health lost, dangers.

### Neutral

- **Night Ink** (`#12141b`): body background, the void behind everything.
- **Slate Ink** (`#101218` → `#454e63`, `slate-950`…`slate-600`): panel fills,
  headers, inputs, borders. Depth is a step on this ladder, never a shadow.
- **Ash Ink** (`#5a657d` → `#bcc4d3`, `slate-500`…`slate-300`): secondary text,
  eyebrow labels, muted icons.
- **Chalk** (`#e7eaf1`): body text and panel-header titles.

### Named Rules

**The One Accent Rule.** A surface carries exactly one accent. Set it with
`--accent` (`accentStyle(color)`); tints and borders derive from it with
`color-mix`. Two accents in one panel is a bug, not a flourish.

**The Ledger Gold Rule.** Gold is reserved for what the player earned: numbers,
ranks, levels, currency, the active tab. Gold is never a background for body copy.

**The Flat Color Rule.** No gradients, no glows, no glassmorphism. The game energy
comes from saturated hues on flat ground — the Melvor-idle discipline, not neon.

## Typography

**Display Font:** Iowan Old Style (with Palatino Linotype, Palatino, Georgia, Noto
Serif, serif)
**Body Font:** system-ui (with -apple-system, Segoe UI, sans-serif)

**Character:** A quiet book serif for the things a player is proud of, and the
operating system's own sans for everything the player has to read quickly. The
serif supplies the "academy"; the sans keeps the app professional and fast.

### Hierarchy

- **Display** (400, inherited size, 1.1 line-height): screen titles, the account
  handle, level numerals, every large stat. Always paired with tabular numerals.
- **Headline** (600, 1.25–1.5rem): section titles inside panels.
- **Title** (600, 0.875–1rem): card titles, exercise prompts.
- **Body** (400, 0.875–1rem, 1.4): instructions, chat text, exercise prompts.
- **Label** (500–600, 0.68rem, 0.14em tracking, uppercase): eyebrows above values,
  field labels, tab labels. Uppercase and tracked, always short.

### Named Rules

**The Serif-For-Stats Rule.** If it is a number the player earned, it is set in
the display serif with `font-variant-numeric: tabular-nums`. If it is a sentence,
it is set in the sans.

**The Quiet Body Rule.** Body copy is never serif and never uppercase. Uppercase
is reserved for the tracked eyebrow label.

## Layout

One column, mobile first. Content sits in a centered `max-width: 42rem` (2xl)
column with 1rem side padding and safe-area insets top and bottom. Panels stack
with a 0.75rem rhythm; related stats form a `grid-cols-3` with 0.625rem gaps.
Density is high but never cramped: cards carry 0.75–1rem internal padding.

Navigation is a fixed bottom bar: six equal tabs, safe-area padded, blurred
`slate-950/90` over the content, active tab lifted with a `slate-800` pill and
gold text. Primary actions live in the thumb zone; on desktop the same column
simply gets more whitespace — there is no multi-column dashboard.

## Elevation & Depth

Flat by construction. There are no drop shadows anywhere in the system. Depth is
tonal: a header is one step lighter than its panel (`slate-800` on `slate-850`),
a panel is one step lighter than the page (`slate-850` on `night-ink`), and a
1px `slate-700` border separates them. Panels add an inset `1px` top highlight
(`rgba(255,255,255,0.04)`) to read as a physical board catching a lamp, and bars
use an inset dark shadow to read as a groove.

The only translucent surfaces are the bottom navigation (`backdrop-blur`) and
badge backgrounds (`rgba(0,0,0,0.25)`).

**The Flat-By-Default Rule.** Depth is a lightness step plus a hairline. If a
surface seems to float, it is wrong; lower its fill instead of adding a shadow.

## Shapes

Soft rectangles with a tight radius scale: 0.6rem for panels and cards, 0.5rem
for buttons and nav pills, 0.4rem for chips and rank badges, 0.75rem for input
fields, 999px for progress bars. Every card is bordered with 1px `slate-700`.

The signature geometry is the **accent edge**: a 3px stripe in the panel's accent
color, either along the top of a tile or the left of a HUD stat card. It is the
system's game tell and is deliberate — but exactly one edge per card. Never both
a top stripe and a left border.

## Components

### Buttons

- **Shape:** 0.5rem radius, inline-flex, 0.4rem icon gap, 0.55rem × 0.9rem padding,
  0.875rem text at weight 600.
- **Primary:** Moonlit Blue fill, white text, 1px darker blue border. Used for the
  one action that moves the session forward.
- **Gold:** Ledger Gold fill, `#2a1d03` text — spending, claiming, rewarding.
- **Ghost:** `slate-800` fill, `slate-600` border, `slate-300` text — secondary
  and destructive-adjacent actions.
- **Accent:** the current `--accent` fill with near-black text — context actions
  inside an accented panel.
- **Hover / Focus:** `filter: brightness(1.08)` on hover; active state translates
  down 1px; disabled drops to 0.4 opacity. Transitions are 0.12s.

### Chips

- **Style:** accent-tinted fill (`color-mix` 18% accent into `slate-900`), 1px
  accent border at 40%, accent-tinted text at 72% toward white, 0.4rem radius,
  0.15rem × 0.45rem padding, 0.68rem text.
- **State:** chips are labels, not toggles; a selected chip is a filled button or
  an active nav pill instead.

### Cards / Containers

- **Corner Style:** 0.6rem.
- **Background:** `slate-850` for panels; accent-tinted `slate-850` (7% accent)
  for panels and tiles that belong to a profession; `slate-800` for panel headers.
- **Shadow Strategy:** none; see Elevation & Depth.
- **Border:** 1px `slate-700`; accent panels mix the accent 50% into the border.
- **Internal Padding:** 0.75rem for stat cards, 1rem for panels, 0.5rem × 0.9rem
  for panel headers.

### Inputs / Fields

- **Style:** `slate-900` fill, 1px `slate-600` border, 0.75rem radius, 0.75–1rem
  padding; drill inputs use 1.125rem text for thumb-readable answers.
- **Focus:** border shifts to `ledger-gold-500`; the default outline is removed.
  No glow, no ring.
- **Error / Disabled:** no dedicated error style yet; disabled buttons drop to 0.4
  opacity. Treat this as a gap, not a pattern.

### Navigation

- **Style:** six equal Gold-active tabs in a sticky bottom bar, emoji icon above an
  11px label, `slate-950/90` blurred background, 1px `slate-700` top border.
- **Default / Hover:** `slate-400` label with `slate-300` on hover.
- **Active:** `slate-800` pill, gold text, icon scaled 110%.
- **Desktop:** identical bar, centered; it does not become a sidebar.

### Signature Components

- **HUD stat card:** 0.6rem card, `slate-850`, 3px left accent edge, tracked
  eyebrow label above a large serif number in the card's accent.
- **Rank badge:** small pill, `rgba(0,0,0,0.25)` fill, 1px gold border at 60%,
  serif gold numerals with tabular figures — the Melvor "(48 / 99)" idiom.
- **Progress bar:** 0.5rem tall, 999px, `slate-800` groove with inset shadow, fill
  in the panel's accent, width transition 0.4s.
- **Challenge tile:** accent-tinted card with a 3px top accent stripe, lifting 1px
  and deepening its tint on hover/focus.

## Do's and Don'ts

### Do:

- **Do** assign color through `--accent` per panel, so tints, borders and edges all
  derive from one hue.
- **Do** set earned numbers in the display serif with tabular figures, gold when
  they are ranks or currency.
- **Do** convey depth with one lightness step plus a 1px hairline, and the inset
  top highlight on panels.
- **Do** keep game color semantic: green = gathering/health/goal, amber =
  artisan/streak/coin, violet = support/talent, red = combat/damage, blue =
  arcane/primary.
- **Do** keep emoji functional — navigation icons and celebration cues only.
- **Do** cap decorative transitions at 0.25s; bars may animate to 0.4s.

### Don't:

- **Don't** add gradients, glows, colored drop shadows, or glassmorphism. The
  energy budget is hue, not light.
- **Don't** put two accent edges on one card (top stripe plus left border) or two
  accent hues in one panel.
- **Don't** use gold as a fill behind body text or as a generic hover color.
- **Don't** set body copy in the serif, or uppercase anything except the tracked
  eyebrow label.
- **Don't** introduce a second display family, a mascot, or a cartoon illustration
  style; the game reads as a ledger, not a nursery.
- **Don't** replace the flat 1px border language with Material-style elevation
  cards.
