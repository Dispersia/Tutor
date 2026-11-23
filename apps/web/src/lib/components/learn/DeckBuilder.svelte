<script lang="ts">
  /** The "build a deck" composer and the Anki-import trigger that sits under it. */

  import { autoGrow } from '#lib/grow'
  import { ACCENT } from '#lib/theme'
  import { LANGUAGES } from '#lib/learnview'
  import Spinner from '#lib/components/Spinner.svelte'

  interface Props {
    instruction: string
    buildLang: string
    building: boolean
    buildError: string
    importing: boolean
    importError: string
    onBuild: () => void
    onInspect: (e: Event) => void
  }

  let {
    instruction = $bindable(),
    buildLang = $bindable(),
    building,
    buildError,
    importing,
    importError,
    onBuild,
    onInspect,
  }: Props = $props()
</script>

<section class="panel panel-accent mb-4 p-4" style="--accent: {ACCENT.azure}">
  <p class="eyebrow">Build a deck</p>
  <p class="mt-1 text-xs text-ink-400">
    Describe what you want. It pulls a real frequency list and writes the cards — one new word at a
    time.
  </p>
  <label class="mt-2 block text-xs text-ink-400">
    Language
    <select bind:value={buildLang} class="field mt-1">
      {#each LANGUAGES as l (l.code)}<option value={l.code}>{l.label}</option>{/each}
    </select>
  </label>
  <label class="mt-2 block text-xs text-ink-400">
    What to learn
    <textarea
      bind:value={instruction}
      use:autoGrow={160}
      rows="2"
      placeholder="a traditional Chinese frequency list, with grammar, using only traditional characters and zhuyin"
      class="field mt-1 resize-none"
    ></textarea>
  </label>
  <button
    type="button"
    onclick={onBuild}
    disabled={building || !instruction.trim()}
    class="btn btn-primary mt-2 w-full py-3"
  >
    {#if building}<Spinner size={15} label="Building the deck" /> Pulling the list &amp; writing cards…{:else}Build
      deck{/if}
  </button>
  {#if buildError}
    <p class="banner mt-2" style="--accent: {ACCENT.ember}" role="alert">{buildError}</p>
  {/if}
  <label class="link link-btn mt-3 w-full justify-center text-xs">
    {#if importing}<Spinner size={12} label="Reading the deck" /> Reading the deck…{:else}…or import
      an Anki deck (.apkg){/if}
    <input
      type="file"
      accept=".apkg,.colpkg"
      class="hidden"
      onchange={onInspect}
      disabled={importing}
    />
  </label>
  {#if importError}
    <p class="banner mt-2" style="--accent: {ACCENT.ember}" role="alert">{importError}</p>
  {/if}
</section>
