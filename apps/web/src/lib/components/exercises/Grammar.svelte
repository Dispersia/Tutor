<script lang="ts">
  import type { Instance } from '#lib/exercises'
  import { typingAttrs } from '#lib/lang'
  import { ACCENT, accentStyle } from '#lib/theme'
  import Spinner from '../Spinner.svelte'
  import CharCell from '../CharCell.svelte'

  let {
    instance,
    busy = false,
    onsubmit,
  }: { instance: Instance; busy?: boolean; onsubmit: (answer: string) => void } = $props()

  let answer = $state('')

  const options = $derived((instance.data.options as string[]) ?? [])
  const rule = $derived((instance.data.rule as string) ?? '')
  const lang = $derived((instance.data.readingLang as string) ?? '')
  const answerLang = $derived((instance.data.answerLang as string) ?? undefined)

  function submit(e: SubmitEvent) {
    e.preventDefault()
    if (answer.trim()) onsubmit(answer.trim())
  }
</script>

<div class="space-y-4">
  {#if rule}
    <span class="chip" style={accentStyle(ACCENT.violet)}>{rule}</span>
  {/if}
  <p class="text-lg leading-snug">{instance.prompt}</p>

  {#if options.length}
    <div class="grid gap-2">
      {#each options as option (option)}
        <CharCell
          word={option}
          {lang}
          size="md"
          wordish={option.length > 1}
          accent={ACCENT.azure}
          stretch
          disabled={busy}
          label={option}
          onclick={() => onsubmit(option)}
        />
      {/each}
    </div>
  {:else}
    <form onsubmit={submit} class="space-y-4">
      <input
        bind:value={answer}
        {...typingAttrs(answerLang)}
        class="field text-lg"
        placeholder="Type the correct form…"
      />
      <button
        type="submit"
        disabled={busy || !answer.trim()}
        data-enter-action
        class="btn btn-primary w-full py-3"
      >
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
