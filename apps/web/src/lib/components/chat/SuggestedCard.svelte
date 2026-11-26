<script lang="ts">
  import { ACCENT, accentStyle } from '#lib/theme'
  import Spinner from '#lib/components/Spinner.svelte'

  interface Props {
    deckName: string
    front: string
    back: string
    reading?: string
    saving: boolean
    onAdd: () => void
    onDismiss: () => void
  }

  let { deckName, front, back, reading, saving, onAdd, onDismiss }: Props = $props()
</script>

<div class="panel panel-accent p-3" style={accentStyle(ACCENT.jade)}>
  <p class="text-xs text-ink-400">Suggested card · {deckName}</p>
  <div class="mt-1 flex items-baseline justify-between gap-3">
    <span class="text-lg break-words text-ink-100">{back}</span>
    {#if reading}<span class="shrink-0 text-xs text-ink-400">{reading}</span>{/if}
  </div>
  <p class="mt-0.5 text-sm text-ink-300">{front}</p>
  <div class="mt-2 flex items-center gap-2">
    <button onclick={onAdd} disabled={saving} class="btn btn-primary px-3 py-1.5 text-sm">
      {#if saving}<Spinner size={13} label="Adding the card" /> Adding…{:else}Add to {deckName}{/if}
    </button>
    <button onclick={onDismiss} class="btn btn-ghost px-3 py-1.5 text-sm">No thanks</button>
  </div>
</div>
