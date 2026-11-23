<script lang="ts">
  import type { PitchContour } from '#lib/types'
  import { htmlLang } from '#lib/lang'
  import { ACCENT, accentStyle } from '#lib/theme'
  import Pitch from './Pitch.svelte'

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
</script>

{#snippet body()}
  <span class="cell__glyph">
    {#if hasRuby}
      {#each segments as seg, i (i)}
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
