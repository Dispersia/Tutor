<script lang="ts">
  import type { PitchContour, PitchLevel } from '#lib/types'
  import { htmlLang } from '#lib/lang'
  import { ACCENT, accentStyle } from '#lib/theme'
  import Pitch from './Pitch.svelte'

  interface Segment {
    base: string
    ruby?: string
  }

  interface Band {
    level: PitchLevel
    next: PitchLevel
  }

  interface Column {
    base: string
    ruby?: string
    bands: Band[]
  }

  function band(levels: PitchLevel[], i: number): Band {
    return { level: levels[i]!, next: levels[i + 1] ?? levels[i]! }
  }

  function sameText(a: string, b: string): boolean {
    const bare = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, '')
    return bare(a) === bare(b)
  }

  function columnFor(seg: Segment, units: string[], levels: PitchLevel[], start: number): Column {
    const col: Column = { base: seg.base, ruby: seg.ruby, bands: [] }
    let need = seg.ruby ?? seg.base
    let i = start
    while (need && i < units.length && need.startsWith(units[i]!)) {
      col.bands.push(band(levels, i))
      need = need.slice(units[i]!.length)
      i++
    }
    return col
  }

  function pitchColumns(segments: Segment[], pitch: PitchContour, reading: string): Column[] {
    const levels = pitch.levels
    const units = pitch.syllables?.length ? pitch.syllables : [...(reading || '')]
    const out: Column[] = []
    let i = 0
    for (const seg of segments) {
      const col = columnFor(seg, units, levels, i)
      i += col.bands.length
      out.push(col)
    }
    const last = out[out.length - 1]
    if (last) last.bands.push(...units.slice(i).map((_, k) => band(levels, i + k)))
    return out
  }

  let {
    word = '',
    reading = '',
    lang = '',
    furigana,
    pitch,
    size = 'md',
    accent = ACCENT.azure,
    wordish = false,
    onclick,
    disabled = false,
    label = '',
    stretch = false,
  }: {
    word?: string
    reading?: string
    lang?: string
    furigana?: Segment[]
    pitch?: PitchContour
    size?: 'sm' | 'md' | 'lg'
    accent?: string
    wordish?: boolean
    onclick?: () => void
    disabled?: boolean
    label?: string
    stretch?: boolean
  } = $props()

  const segments = $derived(furigana ?? [{ base: word }])
  const hasRuby = $derived(segments.some((s) => s.ruby))
  const showPitch = $derived(Boolean(pitch?.levels?.length))
  const readingOnGlyph = $derived(hasRuby || (Boolean(reading) && sameText(reading, word)))
  const columns = $derived(showPitch ? pitchColumns(segments, pitch!, reading) : [])
</script>

{#snippet glyph()}
  {#if hasRuby}
    {#each segments as seg, i (i)}
      {#if seg.ruby}<ruby>{seg.base}<rt>{seg.ruby}</rt></ruby>{:else}{seg.base}{/if}
    {/each}
  {:else}{word}{/if}
{/snippet}

{#snippet body()}
  {#if showPitch && readingOnGlyph}
    <span class="cell__glyph cell__glyph--split">
      {#each columns as col, i (i)}
        <span class="cell__seg">
          <span class="cell__pitch" aria-label="pitch accent">
            {#each col.bands as band, j (j)}
              <span class="cell__mora">
                <span class="cell__line" class:cell__line--high={band.level === 'H'}></span>
                {#if band.next !== band.level}<span class="cell__riser"></span>{/if}
              </span>
            {/each}
          </span>
          <span class="cell__seg-text">
            {#if col.ruby}<ruby>{col.base}<rt>{col.ruby}</rt></ruby>{:else}{col.base}{/if}
          </span>
        </span>
      {/each}
    </span>
  {:else}
    <span class="cell__glyph">{@render glyph()}</span>
    {#if showPitch}
      <span class="cell__reading">
        <Pitch contour={pitch} fallback={reading} size={size === 'lg' ? 'md' : 'sm'} />
      </span>
    {:else if reading && !sameText(reading, word) && !hasRuby}
      <span class="cell__reading">{reading}</span>
    {/if}
  {/if}
{/snippet}

{#if onclick}
  <button
    type="button"
    class="cell cell--{size} cell--press"
    class:cell--word={wordish}
    class:w-full={stretch}
    style={accentStyle(accent)}
    lang={htmlLang(lang)}
    aria-label={label || undefined}
    {disabled}
    {onclick}
  >
    {@render body()}
  </button>
{:else}
  <span
    class="cell cell--{size}"
    class:cell--word={wordish}
    class:w-full={stretch}
    style={accentStyle(accent)}
    lang={htmlLang(lang)}
  >
    {@render body()}
  </span>
{/if}
