<script lang="ts">
  import { ACCENT } from '#lib/theme'
  import { LANGUAGES } from '#lib/learnview'
  import Spinner from '#lib/components/Spinner.svelte'

  interface Props {
    buildLang: string
    building: boolean
    buildError: string
    onStartPath: () => void
  }

  let { buildLang = $bindable(), building, buildError, onStartPath }: Props = $props()
</script>

<section class="panel panel-accent mb-4 p-4" style="--accent: {ACCENT.azure}">
  <p class="eyebrow">Start your path</p>
  <p class="mt-1 text-xs text-ink-400">
    Pick a language. It pulls a real frequency list and writes the cards — everyday words first, one
    new word at a time, and it grows as you go.
  </p>
  <label class="mt-2 block text-xs text-ink-400">
    Language
    <select bind:value={buildLang} class="field mt-1">
      {#each LANGUAGES as l (l.code)}<option value={l.code}>{l.label}</option>{/each}
    </select>
  </label>
  <button
    type="button"
    onclick={onStartPath}
    disabled={building}
    class="btn btn-primary mt-2 w-full py-3"
  >
    {#if building}<Spinner size={15} label="Building the path" /> Pulling the list &amp; writing cards…{:else}Start
      my path{/if}
  </button>
  {#if buildError}
    <p class="banner mt-2" style="--accent: {ACCENT.ember}" role="alert">{buildError}</p>
  {/if}
</section>
