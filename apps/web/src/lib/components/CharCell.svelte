<script lang="ts">
  import type { PitchContour } from '#lib/types'
  import { htmlLang } from '#lib/lang'
  import { ACCENT, accentStyle } from '#lib/theme'
  import Pitch from './Pitch.svelte'

  /**
   * The character cell: the system's signature mark (DESIGN.md §Shapes). A square
   * with faint cross guides, accent-tinted, holding the glyph in the display face
   * with its native reading beneath. It grows to fit a multi-character word and
   * never clips; the `lang` on the glyph picks a serif that matches its script.
   *
   * Pass `onclick` to make the cell a pressable control: it renders as a button,
   * gains the flat hover fill, and goes neutral when disabled.
   */
  interface Segment {
    base: string
    ruby?: string
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
    /** The cell's accent — one per panel. */
    accent?: string
    /** A multi-character word gets a slightly smaller glyph so it stays square-ish. */
    wordish?: boolean
    /** Present = the cell is a control. */
    onclick?: () => void
    disabled?: boolean
    /** Accessible name for a pressable cell. */
    label?: string
    /** Fill the row instead of sitting at its natural width. */
    stretch?: boolean
  } = $props()

  const segments = $derived(furigana ?? [{ base: word }])
  const hasRuby = $derived(segments.some((s) => s.ruby))
  const showPitch = $derived(Boolean(pitch?.levels?.length))
</script>

{#snippet body()}
  <span class="cell__glyph">
    {#if hasRuby}
      {#each segments as seg (seg.base + (seg.ruby ?? ''))}
        {#if seg.ruby}<ruby>{seg.base}<rt>{seg.ruby}</rt></ruby>{:else}{seg.base}{/if}
      {/each}
    {:else}{word}{/if}
  </span>
  {#if showPitch}
    <span class="cell__reading">
      <Pitch contour={pitch} fallback={reading} size={size === 'lg' ? 'md' : 'sm'} />
    </span>
  {:else if reading && !hasRuby}
    <span class="cell__reading">{reading}</span>
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
