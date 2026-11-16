/**
 * Mandarin readings, resolved from the bundled Taiwan dictionary.
 *
 * Chinese cards carry a *reading* as well as the characters, and the deck
 * generator used to ask the model for it — same problem as Japanese pitch: a
 * guess. This looks the reading up instead, in Zhuyin (注音), the phonetic
 * script Taiwan uses.
 *
 * Data: `mandarin-readings.txt` (docs/DESIGN.md §11.1), built by
 * `scripts/build-mandarin-readings.py` from the Ministry of Education's
 * 《重編國語辭典修訂本》 (CC BY-ND 3.0 TW, readings used verbatim; multi-character
 * words and their standard Taiwan pronunciation) and **McBopomofo**
 * (https://github.com/openvanilla/McBopomofo, MIT; each character's preferred
 * reading, plus words the ministry dictionary omits). One `<word>\t<zhuyin>`
 * line per entry.
 *
 * Only Traditional characters have entries: Zhuyin is a Taiwan script, so a
 * Simplified deck keeps the generator's reading.
 */

import readings from './mandarin-readings.txt'

let cached: Map<string, string> | undefined

/** The word → Zhuyin table, parsed once on first use. */
function table(): Map<string, string> {
  if (cached) return cached
  const map = new Map<string, string>()
  for (const line of readings.split('\n')) {
    if (!line) continue
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    map.set(line.slice(0, tab), line.slice(tab + 1))
  }
  return (cached = map)
}

/** The Taiwan Zhuyin for a word, or `undefined` when the dictionary has none. */
export function mandarinZhuyin(word: string): string | undefined {
  if (!word) return undefined
  return table().get(word)
}
