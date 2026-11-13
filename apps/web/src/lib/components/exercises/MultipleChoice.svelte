<script lang="ts">
  import type { Instance } from '#lib/exercises'

  let {
    instance,
    busy = false,
    onsubmit,
  }: { instance: Instance; busy?: boolean; onsubmit: (answer: string) => void } = $props()

  const choices = $derived((instance.data.choices as string[]) ?? [])
</script>

<div class="space-y-4">
  <p class="text-lg leading-snug">{instance.prompt}</p>
  <div class="grid gap-2">
    {#each choices as choice (choice)}
      <button
        onclick={() => onsubmit(choice)}
        disabled={busy}
        class="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-4 text-left text-lg hover:border-emerald-500 disabled:opacity-50"
      >
        {choice}
      </button>
    {/each}
  </div>
</div>
