<script lang="ts">
  import type { Instance } from '#lib/exercises'
  import { ACCENT } from '#lib/theme'
  import Spinner from '../Spinner.svelte'
  import CharCell from '../CharCell.svelte'

  let {
    instance,
    busy = false,
    onsubmit,
  }: { instance: Instance; busy?: boolean; onsubmit: (answer: string) => void } = $props()

  type Segment = { base: string; ruby?: string }
  const choices = $derived((instance.data.choices as string[]) ?? [])
  const readings = $derived((instance.data.choiceReadings as string[]) ?? [])
  const furigana = $derived((instance.data.choiceFurigana as (Segment[] | undefined)[]) ?? [])
  const lang = $derived((instance.data.readingLang as string) ?? '')
</script>

<div class="space-y-4">
  <p class="text-lg leading-snug">{instance.prompt}</p>
  <div class="grid gap-2">
    {#each choices as choice, i (choice)}
      <CharCell
        word={choice}
        reading={readings[i] ?? ''}
        {lang}
        furigana={furigana[i]}
        size="md"
        wordish={choice.length > 1}
        accent={ACCENT.azure}
        stretch
        disabled={busy}
        label={choice}
        onclick={() => onsubmit(choice)}
      />
    {/each}
  </div>
  {#if busy}
    <p class="flex items-center gap-2 text-xs text-ink-400">
      <Spinner size={13} label="Checking your answer" /> Checking…
    </p>
  {/if}
</div>
