<script lang="ts">
  import type { Instance } from '#lib/exercises'
  import Word from '../Word.svelte'

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
      <button
        onclick={() => onsubmit(choice)}
        disabled={busy}
        class="flex flex-col items-center gap-0.5 rounded-xl border border-ink-600 bg-ink-900 px-4 py-4 text-left text-lg hover:border-gold-500 disabled:opacity-50"
      >
        <Word word={choice} reading={readings[i] ?? ''} {lang} furigana={furigana[i]} size="md" />
      </button>
    {/each}
  </div>
</div>
