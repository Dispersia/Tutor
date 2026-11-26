<script lang="ts">
  import { ACCENT } from '#lib/theme'
  import { toasts, type ToastTone } from '#lib/toast.svelte'

  const TONE: Record<ToastTone, string> = {
    success: ACCENT.jade,
    error: ACCENT.ember,
    info: ACCENT.azure,
  }
</script>

{#if toasts.items.length}
  <div
    class="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-8"
    aria-live="polite"
  >
    {#each toasts.items as t (t.id)}
      <div class="toast rise" style="--accent: {TONE[t.tone]}">
        <span class="toast__text">{t.message}</span>
        <button
          type="button"
          class="toast__close"
          aria-label="Dismiss"
          onclick={() => toasts.dismiss(t.id)}>×</button
        >
      </div>
    {/each}
  </div>
{/if}
