<script lang="ts">
  import type { Instance } from '#lib/exercises'
  import { typingAttrs } from '#lib/lang'
  import Spinner from '../Spinner.svelte'

  let {
    instance,
    busy = false,
    onsubmit,
  }: { instance: Instance; busy?: boolean; onsubmit: (answer: unknown) => void } = $props()

  const bank = $derived((instance.data.bank as string[]) ?? [])
  const newWord = $derived((instance.data.newWord as string) ?? '')
  const answerLang = $derived((instance.data.answerLang as string) ?? undefined)

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

  {#if typing}
    <input
      bind:value={typed}
      {...typingAttrs(answerLang)}
      class="field text-lg"
      placeholder="Type the sentence…"
    />
  {:else}
    <div
      class="min-h-[3.5rem] rounded-[12px] border border-dashed border-ink-600 bg-ink-900 px-2 py-2"
    >
      {#if picked.length === 0}
        <span class="text-sm text-ink-400">Tap the words in order…</span>
      {:else}
        <div class="flex flex-wrap gap-1.5">
          {#each picked as bi, pos (pos)}
            <button
              type="button"
              onclick={() => removeAt(pos)}
              class="flex min-h-11 flex-col items-center justify-center rounded-[10px] border border-seal-400 bg-ink-850 px-3 py-2"
            >
              <span class="display text-xl leading-tight">{bank[bi]}</span>
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
          class="flex min-h-11 flex-col items-center justify-center rounded-[10px] border px-3 py-2 transition-colors {picked.includes(
            i,
          )
            ? 'border-ink-700 bg-ink-850 text-ink-400'
            : 'border-ink-600 bg-ink-900 hover:border-seal-400'}"
        >
          <span class="display text-xl leading-tight">{tile}</span>
        </button>
      {/each}
    </div>
  {/if}

  <div class="flex items-center justify-between gap-2">
    <button type="button" onclick={() => (typing = !typing)} class="link link-btn text-xs">
      {typing ? 'Use word tiles' : 'Type it instead'}
    </button>
    {#if newWord}
      <span class="text-xs text-ink-400">new word: {newWord}</span>
    {/if}
  </div>

  <button
    type="submit"
    disabled={busy || (typing ? !typed.trim() : picked.length === 0)}
    data-enter-action
    class="btn btn-primary w-full py-3"
  >
    {#if busy}<Spinner size={15} label="Checking your answer" /> Checking…{:else}Check{/if}
  </button>
</form>
