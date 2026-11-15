<script lang="ts">
  import type { Instance } from '#lib/exercises'
  import Spinner from '../Spinner.svelte'
  import Word from '../Word.svelte'

  let {
    instance,
    busy = false,
    onsubmit,
  }: { instance: Instance; busy?: boolean; onsubmit: (answer: string) => void } = $props()

  let answer = $state('')

  const options = $derived((instance.data.options as string[]) ?? [])
  const rule = $derived((instance.data.rule as string) ?? '')
  const lang = $derived((instance.data.readingLang as string) ?? '')

  function submit(e: SubmitEvent) {
    e.preventDefault()
    if (answer.trim()) onsubmit(answer.trim())
  }
</script>

<div class="space-y-4">
  {#if rule}
    <span class="chip" style="--accent: var(--accent)">{rule}</span>
  {/if}
  <p class="text-lg leading-snug">{instance.prompt}</p>

  {#if options.length}
    <div class="grid gap-2">
      {#each options as option (option)}
        <button
          onclick={() => onsubmit(option)}
          disabled={busy}
          class="flex flex-col items-center gap-0.5 rounded-md border border-ink-600 bg-ink-900 px-4 py-4 text-left text-lg transition-colors hover:border-seal-400 hover:bg-ink-850 disabled:opacity-50"
        >
          <Word word={option} {lang} size="md" />
        </button>
      {/each}
    </div>
  {:else}
    <form onsubmit={submit} class="space-y-4">
      <input
        bind:value={answer}
        autocomplete="off"
        autocapitalize="off"
        class="w-full rounded-md border border-ink-600 bg-ink-900 px-4 py-4 text-lg outline-none focus:border-seal-400"
        placeholder="Type the correct form…"
      />
      <button type="submit" disabled={busy || !answer.trim()} class="btn btn-primary w-full py-3">
        {#if busy}<Spinner size={15} label="Checking your answer" /> Checking…{:else}Check{/if}
      </button>
    </form>
  {/if}

  {#if busy}
    <p class="flex items-center gap-2 text-xs text-ink-400">
      <Spinner size={13} label="Checking your answer" /> Checking…
    </p>
  {/if}
</div>
