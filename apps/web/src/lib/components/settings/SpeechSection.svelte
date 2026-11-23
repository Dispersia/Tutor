<script lang="ts">
  /** The local speech engine: its status, and the wake / free-memory controls. */

  import { accentStyle, ACCENT } from '#lib/theme'
  import Spinner from '#lib/components/Spinner.svelte'
  import type { SpeechStatus } from '#lib/types'

  interface Props {
    speech: SpeechStatus | null
    waking: boolean
    onWake: () => void
    /** Stops the shared gateway — admin only, so absent for members. */
    onFree?: () => void
  }

  let { speech, waking, onWake, onFree }: Props = $props()
</script>

<section class="mb-5 panel panel-accent p-4" style={accentStyle(ACCENT.jade)}>
  <div class="flex items-center justify-between gap-3">
    <div>
      <h2 class="display text-sm text-ink-100">Speech engine</h2>
      <p class="text-xs text-ink-400">
        {speech?.ready ? 'awake' : speech?.running ? 'starting' : 'asleep'}
        {#if speech?.models?.length}· {speech.models.join(', ')}{/if}
      </p>
    </div>
    <div class="flex gap-2">
      {#if !speech?.ready}
        <button
          type="button"
          onclick={onWake}
          disabled={waking || speech?.running}
          aria-busy={waking || speech?.running}
          class="btn btn-ghost px-3 py-1.5 text-xs"
        >
          {#if waking || speech?.running}<Spinner size={12} label="Waking the speech engine" /> Waking…{:else}Wake{/if}
        </button>
      {/if}
      {#if onFree}
        <button type="button" onclick={onFree} class="btn btn-ghost px-3 py-1.5 text-xs"
          >Free memory</button
        >
      {/if}
    </div>
  </div>
  <p class="mt-2 text-xs text-ink-400">
    Voice cards start the models on demand; they unload when idle.
  </p>
</section>
