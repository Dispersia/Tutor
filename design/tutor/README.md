# Tutor

Six standalone HTML screens for a game-flavoured, local-first language tutor, built to a
pinned visual system. Open `index.html` in a browser. There is no build step, no server,
and no network at runtime — every screen works from `file://`.

```
design/tutor/
├── index.html          the guild hall — hero, daily goal, running rigs, study rhythm, bank
├── skills.html         professions — 23 trades in four groups
├── profession.html     profession detail — Mining: the action list and its live rig
├── talents.html        talents — the milestone ladder, done / open / locked, two capstones
├── learn.html          the Scriptorium — build a deck, drill a deck, edit a card
├── practice.html       the drill — a correct answer powers the rig
├── styles/
│   ├── game.css        tokens, reset, shell, and the shared component set
│   └── game-ui.css     forms, sheets, the character cell, the talent ladder, rails
├── assets/
│   ├── game.js         the inline SVG icon sprite, rig ticker, sheets, talents, drill
│   └── fonts/          977 self-hosted woff2 files + fonts.css (see below)
└── tools/
    └── fetch-fonts.sh  re-vendors assets/fonts from the npm registry
```

## Running it

```sh
open design/tutor/index.html          # macOS
xdg-open design/tutor/index.html      # Linux
```

Any static file server works too, but nothing requires one.

## The screens

| Screen | What it does |
| --- | --- |
| `index.html` | Account level medallion, gold / streak / drills-today figures, the daily-goal bar, three rigs ticking live, a 14-week activity map, and the bank ledger. One ember action: **Start a drill**. |
| `skills.html` | All 23 professions as ruled rows with level bars, grouped Gathering / Artisan / Support / Combat, each group carrying its own accent. |
| `profession.html` | Mining at Lv 34: the running action and its live rig, a talent summary, five actions with tier / XP / unlock level / outputs (one locked), and the cross-profession feed into Smithing. |
| `talents.html` | The whole ladder — Lv 10 and 20 bound, Lv 30 open with three choices, Lv 40–90 locked, capstones at Lv 50 and Lv 100. Choices persist in `localStorage`; the open node can be respec'd. |
| `learn.html` | Four frequency-path decks (Japanese, Mandarin with Zhuyin, Korean, Russian), one generating, one errored with a retry, a deck builder that validates inline, and a card-editor sheet. |
| `practice.html` | The character cell, a translate prompt, an answer field, and a Submit that reveals the FSRS result, the XP, the material, and the rig extension. |

## Interaction

`assets/game.js` is dependency-free and does five things:

- **Icon sprite.** Injects one drawn single-stroke set (24×24, `stroke-width` 1.7, round
  caps) before the body parses, so every `<use href="#i-…">` resolves from the filesystem.
- **Live rigs.** Any `[data-rig]` extrapolates on the client between fetches: the counter
  climbs, the run bar drains, the clock counts down. The bank's copper pile rides the same
  clock.
- **Sheets.** `[data-sheet-open]` opens a bottom sheet (a centred dialog at ≥1024px), moves
  focus in, traps Tab, closes on `Escape` or a scrim click, and returns focus.
- **Talents.** Choices are recorded per profession in `localStorage` and the ladder
  re-renders; the open node has a respec.
- **Builder and drill.** The builder validates on submit with an inline error and never
  leaves its button disabled; the drill grades the answer and reveals the result panel.

`prefers-reduced-motion` is honoured, and the account sheet carries a working
"reduce motion" switch.

## Fonts

Self-hosted, not optional: the app must render CJK, kana, Hangul, Bopomofo and Cyrillic on
a machine whose OS ships no such font. `assets/fonts/` vendors the Fontsource variable
packages for Space Grotesk, Rubik, Noto Serif, and Noto Sans/Serif SC/TC/JP/KR — 977
`unicode-range` subsets, ~49 MB, loaded on demand by the browser. Nothing hotlinks a CDN.

`tools/fetch-fonts.sh` re-vendors the whole set from the npm registry. It is a
maintenance script, not part of the shipped site.

Regional faces are selected by `lang`: `:lang(ja)`, `:lang(ko)`, `:lang(zh-Hant)` and
`:lang(zh-Hans)` reorder the CJK stack so Japanese kanji never take Chinese glyph shapes.
Every language-bearing node carries its `lang`.

## What this is not

A prototype of six screens, not the tutor application. There is no server, no speech, no
scheduling, and no persistence beyond `localStorage`.
