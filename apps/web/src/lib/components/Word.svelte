<script lang="ts">
  interface Segment {
    base: string
    ruby?: string
  }

  let {
    word = '',
    reading = '',
    lang = '',
    furigana,
    size = 'lg',
  }: {
    word?: string
    reading?: string
    lang?: string
    furigana?: Segment[]
    size?: 'sm' | 'md' | 'lg'
  } = $props()

  const segments = $derived(furigana ?? [{ base: word }])
  const hasRuby = $derived(segments.some((s) => s.ruby))
  const text = $derived(size === 'lg' ? 'text-4xl' : size === 'md' ? 'text-2xl' : 'text-xl')
</script>

<span class="inline-flex flex-col items-center leading-tight">
  <span class="display {text} leading-normal">
    {#if hasRuby}
      {#each segments as seg (seg.base + (seg.ruby ?? ''))}
        {#if seg.ruby}
          <ruby>{seg.base}<rt class="text-[0.4em] opacity-90">{seg.ruby}</rt></ruby>
        {:else}{seg.base}{/if}
      {/each}
    {:else}{word}{/if}
  </span>
  {#if reading && !hasRuby}
    <span class="mt-1 text-sm tracking-wide opacity-90">{reading}</span>
  {/if}
</span>
