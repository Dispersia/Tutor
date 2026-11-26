# Third-party material

The code in this repository is licensed under the PolyForm Noncommercial License
1.0.0 (see `LICENSE.md`). The files below are bundled with it but belong to
others and keep **their own** licences, which apply to them instead.

## Dictionary data

| File                                         | Source                                                                                                                                | Licence                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `apps/server/src/deck/kanjium-accents.txt`   | Kanjium pitch-accent data, by Uros O. and the Kanjium project — <https://github.com/mifunetoshiro/kanjium>                            | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)       |
| `apps/server/src/deck/mandarin-readings.txt` | 中華民國教育部《重編國語辭典修訂本》, via the [g0v/moedict-data](https://github.com/g0v/moedict-data) mirror (readings used verbatim) | [CC BY-ND 3.0 TW](https://creativecommons.org/licenses/by-nd/3.0/tw/) |
| `apps/server/src/deck/mandarin-readings.txt` | Preferred character readings and additional words from [McBopomofo](https://github.com/openvanilla/McBopomofo)                        | MIT                                                                   |

`scripts/build-mandarin-readings.py` shows how the Mandarin file is assembled
from those two sources.

## Fonts (`apps/web/src/assets/*.woff2`)

Subsets of eleven families, every one published under the SIL Open Font License
1.1. They come from the [Fontsource](https://fontsource.org) packages listed in
`design/tutor/tools/fetch-fonts.sh`; each package declares `OFL-1.1` (versions
checked 2026-11-26). The full licence text is in
`apps/web/src/assets/OFL.txt`.

| Family                                | Copyright                              |
| ------------------------------------- | -------------------------------------- |
| Space Grotesk                         | 2020 The Space Grotesk Project Authors |
| Rubik                                 | 2015 The Rubik Project Authors         |
| Noto Serif (latin / greek / cyrillic) | 2022 The Noto Project Authors          |
| Noto Sans and Noto Serif SC/TC/JP/KR  | Google Inc.                            |

## Speech models

No model weights are stored in this repository. The gateway downloads Whisper
large-v3-turbo, VoxCPM2 and the Qwen3 forced aligner at run time; each is
governed by the licence on its own model card.
