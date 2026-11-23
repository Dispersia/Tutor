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

Subsets of Noto Sans / Noto Serif (JP, KR, SC, TC, Cyrillic), Rubik and Space
Grotesk. These families are published under the SIL Open Font License 1.1; check
each family's own licence file before redistributing the subsets.

## Speech models

No model weights are stored in this repository. The gateway downloads Whisper
large-v3-turbo, VoxCPM2 and the Qwen3 forced aligner at run time; each is
governed by the licence on its own model card.
