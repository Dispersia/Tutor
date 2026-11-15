<script lang="ts">
  import type { PitchContour } from '#lib/types'
  import { htmlLang } from '#lib/lang'
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
    size = 'lg',
  }: {
    word?: string
    reading?: string
    lang?: string
    furigana?: Segment[]
    /** Language-agnostic pitch contour (Japanese pitch accent, tones). */
    pitch?: PitchContour
    size?: 'sm' | 'md' | 'lg'
  } = $props()

  const segments = $derived(furigana ?? [{ base: word }])
  const hasRuby = $derived(segments.some((s) => s.ruby))
  const text = $derived(size === 'lg' ? 'text-4xl' : size === 'md' ? 'text-2xl' : 'text-xl')
  const showPitch = $derived(Boolean(pitch?.levels?.length))
</script>

<span lang={htmlLang(lang)} class="inline-flex flex-col items-center leading-tight">
  <span class="display {text} leading-normal">
    {#if hasRuby}
      {#each segments as seg (seg.base + (seg.ruby ?? ''))}
        {#if seg.ruby}
          <ruby>{seg.base}<rt class="text-[0.4em] opacity-90">{seg.ruby}</rt></ruby>
        {:else}{seg.base}{/if}
      {/each}
    {:else}{word}{/if}
  </span>
  {#if showPitch}
    <span class="mt-1">
      <Pitch contour={pitch} fallback={reading} size={size === 'lg' ? 'md' : 'sm'} />
    </span>
  {:else if reading && !hasRuby}
    <span class="mt-1 text-sm tracking-wide opacity-90">{reading}</span>
  {/if}
</span>
