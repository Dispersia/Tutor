---
name: tutor
description: A local-first, game-flavoured language tutor — a night dictionary: deep ink ground, a vermilion seal for the action, brass figures for what you earned.
colors:
  ink-950: '#090d12'
  ink-900: '#0e141b'
  ink-850: '#131b24'
  ink-800: '#1a242f'
  ink-700: '#26323f'
  ink-600: '#35434f'
  ink-500: '#586673'
  ink-400: '#8694a1'
  ink-300: '#b8c3cd'
  ink-200: '#d7dee5'
  ink-100: '#e8edf2'
  gold-200: '#f6e4b0'
  gold-300: '#eac168'
  gold-400: '#d9a93c'
  gold-500: '#b9862a'
  gold-600: '#8f6620'
  seal-300: '#f0735a'
  seal-400: '#e2452b'
  seal-500: '#c63620'
  seal-600: '#a62c19'
  jade-300: '#7bd3a9'
  jade-400: '#45c08a'
  jade-500: '#2fa274'
  brass-300: '#efc078'
  brass-400: '#e3a64a'
  brass-500: '#c4862f'
  violet-300: '#c6aef0'
  violet-400: '#ac8be6'
  ember-300: '#ee8e86'
  ember-400: '#e0655c'
  ember-500: '#c64a41'
  azure-300: '#9cc6f2'
  azure-400: '#6aa9e9'
  azure-500: '#4a8ad0'
  on-seal: '#ffffff'
  on-gold: '#2a1d03'
  scrim: 'rgba(0, 0, 0, 0.28)'
typography:
  display:
    fontFamily: "'Source Serif 4', 'Songti SC', 'Noto Serif CJK SC', 'Source Han Serif SC', 'Hiragino Mincho ProN', 'Noto Serif SC', serif"
    letterSpacing: '0.01em'
  body:
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif'
    fontSize: '0.875rem'
  headline:
    fontSize: '1.5rem'
    fontWeight: 600
  title:
    fontSize: '1rem'
    fontWeight: 600
  small:
    fontSize: '0.6875rem'
    fontWeight: 400
  caption:
    fontSize: '0.625rem'
    fontWeight: 400
  micro:
    fontSize: '8px'
    fontWeight: 600
  note:
    fontSize: '13px'
    fontWeight: 400
  reading:
    fontSize: '15px'
    fontWeight: 400
  label:
    fontSize: '0.66rem'
    letterSpacing: '0.16em'
    fontWeight: 600
rounded:
  panel: '5px'
  button: '4px'
  chip: '3px'
  field: '6px'
  cell: '3px'
  bar: '2px'
spacing:
  xs: '0.25rem'
  sm: '0.5rem'
  md: '0.75rem'
  lg: '1rem'
components:
  button-primary:
    backgroundColor: '{colors.seal-400}'
    textColor: '#ffffff'
    rounded: '{rounded.button}'
    padding: '0.55rem 0.9rem'
  button-gold:
    backgroundColor: '{colors.gold-400}'
    textColor: '#2a1d03'
    rounded: '{rounded.button}'
    padding: '0.55rem 0.9rem'
  button-ghost:
    backgroundColor: '{colors.ink-800}'
    textColor: '{colors.ink-300}'
    rounded: '{rounded.button}'
    padding: '0.55rem 0.9rem'
  button-accent:
    backgroundColor: '{colors.azure-400}'
    textColor: '#08111b'
    rounded: '{rounded.button}'
    padding: '0.55rem 0.9rem'
  panel:
    backgroundColor: '{colors.ink-850}'
    textColor: '{colors.ink-200}'
    rounded: '{rounded.panel}'
    padding: '0'
  stat-card:
    backgroundColor: '{colors.ink-850}'
    rounded: '{rounded.panel}'
    padding: '0.75rem'
  level-badge:
    backgroundColor: 'rgba(0, 0, 0, 0.28)'
    textColor: '{colors.gold-300}'
    rounded: '{rounded.chip}'
    padding: '0.1rem 0.35rem'
  seal:
    backgroundColor: 'color-mix(in oklab, #e2452b 12%, transparent)'
    textColor: '{colors.seal-300}'
    rounded: '{rounded.button}'
    padding: '0.25rem'
---

# Design System: tutor

## Overview

**Creative North Star: "The Lexicon"**

A night dictionary a household actually uses every day. The page is deep ink —
near-black with a faint blue cast — and the language lives in a **ruled character
cell**: a square drawn with a hairline and faint cross guides, accent-tinted,
holding the character under study. Colour is a role, never a mood: a **vermilion
seal** marks the single action that moves the session forward and stamps the level
you earned; **jade** is what grows; a **brass gold** figures every number the
player earned; **azure, violet, brass and ember** are data — arcane, support,
artisan, combat — and always mean the same thing. Nothing glows, nothing
gradients, nothing floats, and nothing is light: the app is one dark room.

This is a replacement of the earlier Melvor-flavoured system, not a refinement of
it: the old slate ladder, ledger gold and moonlit blue are gone, and so is the
light paper plate the first draft of this world used. What survives is the
discipline — one accent per surface, tabular figures, ruled entries, a
quarter-second motion budget — and the household's freedom to change the name,
palette and theme again later.

**Key Characteristics:**

- Flat deep-ink ground (`#090d12` → `#1a242f`), no gradients, no shadows, no light surfaces
- The **character cell** — a hairline square with faint cross guides — holds the studied character
- One **vermilion seal** for the forward action; brass gold for earned numbers
- Ruled entries (1px rules) instead of a card grid; 3–5px radii
- Mobile-first single column (max 42rem), three-tab bottom bar, and a title bar with the account behind a profile stamp
- Desktop moves both bars into a persistent **left rail** and opens pages into a wider, sometimes two-column **spread**

## Colors

A dark ink ladder, a gold ledger, a vermilion seal, and five saturated semantic
accents — colour is data, not decoration.

### Primary

- **Seal Vermilion** (`#e2452b`): the action colour. Primary buttons, the active
  tab, the level stamp. It is the one thing that moves the session forward.

### Secondary

- **Brass Gold** (`#eac168`): the reward colour. Every number the player earned —
  XP, streak, ranks, currency, the level figure. Never a background for body copy.

### Tertiary

- **Jade** (`#45c08a`): what grows — daily goal, player health, gathering, success.
- **Brass Amber** (`#e3a64a`): artisan, streak, coins, warnings.
- **Azure** (`#6aa9e9`): the academy — levels, chat, the next-word entry.
- **Violet** (`#ac8be6`): support and talents.
- **Ember** (`#e0655c`): combat, damage, danger.

### Neutral

- **Ink** (`#090d12` → `#e8edf2`, `ink-950`…`ink-100`): the ground and the surface
  ladder above it. Depth is one step on this ladder, never a shadow. The app is
  entirely dark; there is no light surface.

### Named Rules

**The One Accent Rule.** A surface carries exactly one accent. Set it with
`--accent` (`accentStyle(color)`); tints and borders derive from it with
`color-mix`. Two accents in one panel is a bug, not a flourish.

**The Cell Holds The Word Rule.** The character cell is reserved for language —
the character or word under study. It is never a generic container.

**The Flat Colour Rule.** No gradients, no glows, no shadows, no glassmorphism.
The energy budget is hue, not light.

## Typography

**Display Font:** Source Serif 4, self-hosted (`src/assets/source-serif-4-latin.woff2`),
with an explicit CJK serif stack behind it (`Songti SC`, `Noto Serif CJK SC`,
`Source Han Serif SC`, `Hiragino Mincho ProN`).
**Body Font:** system-ui (with -apple-system, Segoe UI, sans-serif).

**Character:** A book serif carries the things a player is proud of — names,
headings, characters, and every number that matters — and the operating system's
own sans carries everything read quickly. The serif supplies the "dictionary"; the
sans keeps the app fast. Self-hosting the Latin keeps the lettering identical on
every device.

### Hierarchy

- **Display** (400–700, inherited size, 1.05 line-height): screen titles, the
  account handle, level numerals, every large stat. Always tabular numerals.
- **Headline** (600, 1.25–1.5rem): section titles.
- **Title** (500–600, 0.875–1rem): row names, exercise prompts.
- **Body** (400, 0.875–1rem, 1.4): instructions, chat text, prompts.
- **Label** (600, 0.66rem, 0.16em tracking, uppercase): row labels, field labels.
  Uppercase is reserved for this label.

### Named Rules

**The Serif-For-Earned Rule.** If it is a number the player earned, it is set in
the display serif with `font-variant-numeric: tabular-nums`. Sentences are sans.

**The Quiet Body Rule.** Body copy is never serif and never uppercase.

## Layout

One column, mobile first. Content sits in a centered `max-width: 42rem` column
with 1rem side padding and safe-area insets. Pages open with a header carrying a
1px rule beneath it; the rule always keeps 1rem of air below it, so a panel or
heading never sits on the line. Content below is **ruled entries** — rows
separated by 1px `ink-700` rules — rather than a grid of cards. Density is high
but never cramped: rows carry 0.75–1rem vertical padding.

From `min-width: 1024px` the column widens (`max-width: 72rem`) and a page may
open into a **spread** — two ruled columns set side by side, like the two pages of
an open dictionary — while a focused task (the drill, a conversation) stays in a
centered narrower measure. Pages that spread: Home (activity map beside the earned
figures), Learn (the deck composer beside the path), Skills (categories flowing
into two balanced columns), Skills detail (the ledger beside the talent ladder and
actions), Settings (panels in two columns). Lists with ragged heights use CSS
columns so the two sides stay balanced; card lists use a plain two-column grid.

Navigation is two fixed surfaces on a phone. A **title bar** at the top carries the
app mark and, on the right, a personal **profile stamp** — a small square holding
the member's initial — whose menu holds Chat, Bank, History, Settings and Sign out.
Three equal tabs sit in the thumb zone at the bottom: **Home, Skills, Learn**.
Both are safe-area padded and blurred `ink-950/90` over the content; the active
tab, and the stamp on an account screen, read in seal vermilion on a
`seal-400/12` pill, with drawn single-stroke SVG icons.

On desktop both bars disappear and every destination moves into a persistent
**left rail** — the dictionary's spine: the wordmark, then Home / Skills / Learn,
a hairline rule, then Chat / Bank / History / Settings, with the member's stamp and
Sign out pinned at the foot. The rail is flat `ink-950` behind a 1px `ink-700`
rule and takes the same `seal-400/12` active pill as the phone tab. The page
scrolls beside it; primary actions stay with the content rather than the rail.

## Elevation & Depth

Flat by construction. There are no drop shadows anywhere in the system. Depth is
tonal: a panel is one step lighter than the page (`ink-850` on `ink-950`), a
header is one step lighter than its panel, and a 1px `ink-700` border separates
them. Bars are a recessed groove drawn with a 1px border, not a shadow.

The only translucent surfaces are the bottom navigation (`backdrop-blur`) and
badge backgrounds (`rgba(0,0,0,0.28)`).

**The Flat-By-Default Rule.** Depth is a lightness step plus a hairline. If a
surface seems to float, it is wrong; lower its fill instead of adding a shadow.

## Shapes

Soft rectangles with a tight radius scale: 5px for panels, 4px for buttons and
nav pills, 3px for chips, cells and rank badges, 6px for input fields. Every panel
is bordered with 1px `ink-700`.

The signature geometry is the **character cell**: a square ruled with faint cross
guides, holding one character. It appears wherever the app shows
the language — the next-word entry, the practice stage, the sentence tiles — and
is the system's game tell. A secondary tell is the **seal**: a small square stamp
with a vermilion border holding the earned level.

## Components

### Buttons

- **Shape:** 4px radius, inline-flex, 0.4rem icon gap, 0.55rem × 0.9rem padding,
  0.875rem text at weight 600.
- **Primary:** Seal Vermilion fill, white text, 1px darker seal border. The one
  action that moves the session forward.
- **Gold:** Brass Gold fill, `#2a1d03` text — spending, claiming, rewarding.
- **Ghost:** `ink-800` fill, `ink-600` border, `ink-300` text — secondary and
  destructive-adjacent actions.
- **Accent:** the current `--accent` fill with near-black text — context actions.
- **Hover / Focus:** `filter: brightness(1.08)` on hover; active state translates
  down 1px; disabled drops to 0.4 opacity. Transitions are 0.12s.

### Chips

- **Style:** accent-tinted fill (`color-mix` 16% accent into `ink-900`), 1px accent
  border at 45%, accent-tinted text at 68% toward white, 3px radius,
  0.16rem × 0.45rem padding, 0.68rem text.

### Cards / Containers

- **Corner Style:** 5px.
- **Background:** `ink-850` for panels; accent-tinted `ink-850` (10% accent) for
  panels that belong to a section; `ink-800` for panel headers.
- **Shadow Strategy:** none; see Elevation & Depth.
- **Border:** 1px `ink-700`; accent panels mix the accent 42% into the border.
- **Internal Padding:** 0.75rem for rows and stat cards, 1rem for panels.

### Inputs / Fields

- **Style:** `ink-900` fill, 1px `ink-600` border, 6px radius, 0.75–1rem padding;
  drill inputs use 1.125rem text for thumb-readable answers.
- **Focus:** border shifts to `seal-400`. No glow, no ring.
- **Error / Disabled:** disabled buttons drop to 0.4 opacity; errors use `ember-950`
  ground with `ember-300` text. Treat the absence of an inline error style as a gap.

### Navigation

- **Style:** a sticky top title bar (app mark + profile stamp) over three equal
  seal-active tabs in a sticky bottom bar; a drawn single-stroke SVG icon above an
  11px label; `ink-950/90` blurred background; 1px `ink-700` border.
- **Desktop (≥1024px):** both bars give way to one fixed 15rem left rail — wordmark,
  Home / Skills / Learn, a hairline, Chat / Bank / History / Settings, then the
  member stamp and Sign out at the foot; flat `ink-950` behind a 1px `ink-700` rule.
- **Default / Hover:** `ink-400` label with `ink-200` on hover.
- **Active:** `seal-400/12` pill, `seal-300` label and icon. The profile stamp takes
  the same seal border when its menu is open or its screen is current.

### Signature Components

- **Character cell:** an accent-tinted square (3px radius) with a 1px accent border
  and faint cross guides at 20% accent, holding one character in the display serif.
- **Level seal:** a 3.5rem square stamp, 1.5px vermilion border, `seal-400/12` fill,
  serif level figure in `seal-300` with a tracked `LEVEL` label.
- **Rank badge:** small pill, `rgba(0,0,0,0.28)` fill, 1px gold border at 60%, serif
  gold numerals with tabular figures.
- **Profile stamp:** a 2rem square stamp, 1px `ink-600` border, holding the member's
  initial in the display serif; seal vermilion when its menu is open.
- **Progress bar:** 6px tall, 3px radius, `ink-800` groove with a 1px `ink-700`
  border, fill in the panel's accent, width transition 0.4s.
- **Ruled entry:** a row separated by a 1px `ink-700` rule, label left and an earned
  figure right, or a shortcut row with a drawn accent icon.
- **Activity map:** a heat-map grid of 0.75rem squares — one column per
  Monday-first week, one row per weekday; empty days sit in `ink-800`, active days
  in the section accent at 28 / 50 / 72 / 100%, with a `Less → More` legend.

## Do's and Don'ts

### Do:

- **Do** assign colour through `--accent` per surface, so tints and borders derive
  from one hue.
- **Do** set earned numbers in the display serif with tabular figures, brass gold
  when they are XP, streak, rank or currency.
- **Do** keep the character cell for language only, and the seal vermilion for the one
  forward action.
- **Do** convey depth with one lightness step plus a 1px hairline.
- **Do** keep colour semantic: jade grows, brass earns, azure is the academy, violet
  is support, ember is combat.
- **Do** draw icons — one stroke and weight — and reserve emoji for server-provided
  content (item, profession and monster marks).
- **Do** cap decorative transitions at 0.25s; bars may animate to 0.4s.

### Don't:

- **Don't** add gradients, glows, coloured drop shadows, or glassmorphism.
- **Don't** put two accents in one panel or use gold as a fill behind body text.
- **Don't** set body copy in the serif, or uppercase anything except the tracked label.
- **Don't** use the character cell as a generic container, or the seal vermilion for anything
  but the forward action and earned ranks.
- **Don't** reintroduce a card grid where a ruled entry belongs.
