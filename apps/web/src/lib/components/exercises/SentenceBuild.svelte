<script lang="ts">
  import type { Instance } from '#lib/exercises'

  let {
    instance,
    busy = false,
    onsubmit,
  }: { instance: Instance; busy?: boolean; onsubmit: (answer: unknown) => void } = $props()

  const bank = $derived((instance.data.bank as string[]) ?? [])
  const bankReadings = $derived((instance.data.bankReadings as string[]) ?? [])
  const reading = $derived((instance.data.reading as string) ?? '')
  const gloss = $derived((instance.data.gloss as string) ?? '')
  const newWord = $derived((instance.data.newWord as string) ?? '')

  // Which bank tiles are currently placed, by bank index (so repeats work).
  let picked = $state<number[]>([])
  let typing = $state(false)
  let typed = $state('')

  const built = $derived(picked.map((i) => bank[i] ?? '').join(''))

  function tap(i: number) {
    if (busy) return
    if (picked.includes(i)) picked = picked.filter((x) => x !== i)
    else picked = [...picked, i]
  }

  function removeAt(pos: number) {
    if (busy) return
    picked = picked.filter((_, idx) => idx !== pos)
  }

  function submit(e: SubmitEvent) {
    e.preventDefault()
    const answer = typing ? typed.trim() : built
    if (answer) onsubmit(answer)
  }
</script>

<form onsubmit={submit} class="space-y-4">
  <p class="text-lg leading-snug">{instance.prompt}</p>
  {#if reading}
    <p class="text-xs text-ink-400">{gloss} · {reading}</p>
  {/if}

  {#if typing}
    <input
      bind:value={typed}
      autocomplete="off"
      autocapitalize="off"
      class="w-full rounded-xl border border-ink-600 bg-ink-900 px-4 py-4 text-lg outline-none focus:border-gold-500"
      placeholder="Type the sentence…"
    />
  {:else}
    <div
      class="min-h-[3.5rem] rounded-xl border border-dashed border-ink-600 bg-ink-950/40 px-2 py-2"
    >
      {#if picked.length === 0}
        <span class="text-sm text-ink-500">Tap the words in order…</span>
      {:else}
        <div class="flex flex-wrap gap-1.5">
          {#each picked as bi, pos (pos)}
            <button
              type="button"
              onclick={() => removeAt(pos)}
              class="flex flex-col items-center rounded-lg border border-gold-500/60 bg-ink-900 px-3 py-1.5"
            >
              <span class="text-xl leading-tight">{bank[bi]}</span>
              {#if bankReadings[bi]}
                <span class="text-[10px] text-ink-400">{bankReadings[bi]}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="flex flex-wrap gap-1.5">
      {#each bank as tile, i (i)}
        <button
          type="button"
          onclick={() => tap(i)}
          disabled={busy}
          class="flex flex-col items-center rounded-lg border px-3 py-1.5 disabled:opacity-50 {picked.includes(
            i,
          )
            ? 'border-ink-700 bg-ink-900 text-ink-500'
            : 'border-ink-600 bg-ink-900 hover:border-gold-500'}"
        >
          <span class="text-xl leading-tight">{tile}</span>
          {#if bankReadings[i]}
            <span class="text-[10px] {picked.includes(i) ? 'text-ink-600' : 'text-ink-400'}"
              >{bankReadings[i]}</span
            >
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  <div class="flex items-center justify-between gap-2">
    <button type="button" onclick={() => (typing = !typing)} class="text-xs text-ink-400 underline">
      {typing ? 'Use word tiles' : 'Type it instead'}
    </button>
    {#if newWord}
      <span class="text-[11px] text-ink-500">new word: {newWord}</span>
    {/if}
  </div>

  <button
    type="submit"
    disabled={busy || (typing ? !typed.trim() : picked.length === 0)}
    class="w-full rounded-xl bg-emerald-500 py-3 font-medium text-black disabled:opacity-40"
  >
    Check
  </button>
</form>
