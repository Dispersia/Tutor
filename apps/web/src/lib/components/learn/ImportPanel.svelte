<script lang="ts">
  /** The Anki import step 2: pick the language and the mapping, then build. */

  import type { AnkiInspection } from '#lib/exercises'
  import { ACCENT } from '#lib/theme'
  import { LANGUAGES, cell, langLabel } from '#lib/learnview'
  import Spinner from '#lib/components/Spinner.svelte'

  interface Props {
    inspection: AnkiInspection
    importLang: string
    wordField: number
    readingField: number
    meaningField: number
    importing: boolean
    onConfirm: () => void
    onCancel: () => void
  }

  let {
    inspection,
    importLang = $bindable(),
    wordField = $bindable(),
    readingField = $bindable(),
    meaningField = $bindable(),
    importing,
    onConfirm,
    onCancel,
  }: Props = $props()
</script>

<section class="panel panel-accent mb-4 p-4" style="--accent: {ACCENT.violet}">
  <div class="flex items-baseline justify-between">
    <p class="eyebrow">Import {inspection.name ?? 'Anki deck'}</p>
    <span class="text-xs text-ink-400">{inspection.noteCount} notes</span>
  </div>
  <p class="mt-1 text-xs text-ink-400">
    Pick the deck's language and which field is the real word. The whole deck is imported — the AI
    weaves sentence and grammar cards through its words and fills it in the background.
  </p>

  <label class="mt-3 block text-xs text-ink-400">
    Language
    <select bind:value={importLang} class="field mt-1">
      {#if importLang && !LANGUAGES.some((l) => l.code === importLang)}
        <option value={importLang}>{importLang}</option>
      {/if}
      {#each LANGUAGES as l (l.code)}<option value={l.code}>{l.label}</option>{/each}
    </select>
  </label>
  {#if inspection.suggestedLang}
    <p class="mt-1 text-xs text-jade-400">
      Detected {langLabel(inspection.suggestedLang)} from the deck.
    </p>
  {/if}

  <label class="mt-3 block text-xs text-ink-400">
    Word field
    <select bind:value={wordField} class="field mt-1">
      {#each inspection.fields as f, i (i)}<option value={i}>{f}</option>{/each}
    </select>
  </label>

  <div class="mt-2 grid grid-cols-2 gap-2">
    <label class="block text-xs text-ink-400">
      Reading (optional)
      <select bind:value={readingField} class="field mt-1">
        <option value={-1}>None</option>
        {#each inspection.fields as f, i (i)}<option value={i}>{f}</option>{/each}
      </select>
    </label>
    <label class="block text-xs text-ink-400">
      Meaning (optional)
      <select bind:value={meaningField} class="field mt-1">
        <option value={-1}>None</option>
        {#each inspection.fields as f, i (i)}<option value={i}>{f}</option>{/each}
      </select>
    </label>
  </div>

  <div class="mt-3 overflow-x-auto">
    <table class="w-full text-left text-xs text-ink-400">
      <thead>
        <tr
          >{#each inspection.fields as f (f)}<th class="pr-2 font-normal">{f}</th>{/each}</tr
        >
      </thead>
      <tbody>
        {#each inspection.sample.slice(0, 3) as row, r (r)}
          <tr>
            {#each row as value, i (i)}<td class="pr-2 text-ink-300">{cell(value)}</td>{/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="mt-3 flex gap-2">
    <button
      type="button"
      onclick={onConfirm}
      disabled={importing}
      class="btn btn-primary flex-1 py-3"
    >
      {#if importing}<Spinner size={15} label="Building the deck" /> Building…{:else}Build deck{/if}
    </button>
    <button type="button" onclick={onCancel} disabled={importing} class="btn btn-ghost px-4">
      Cancel
    </button>
  </div>
</section>
