<script lang="ts">
  import { ACCENT } from '#lib/theme'

  interface Props {
    open: boolean
    title: string
    message: string
    confirmLabel: string
    busy?: boolean
    onConfirm: () => void
    onCancel: () => void
  }

  let { open, title, message, confirmLabel, busy = false, onConfirm, onCancel }: Props = $props()
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && !busy && onCancel()} />

{#if open}
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center">
    <button class="absolute inset-0" aria-label="Cancel" onclick={onCancel}></button>
    <div
      class="panel relative z-10 w-full max-w-md p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <h2 class="eyebrow" style="color: {ACCENT.ember}">{title}</h2>
      <p class="mt-2 text-sm text-ink-200">{message}</p>
      <div class="mt-4 flex justify-end gap-2">
        <button class="btn btn-ghost px-3 py-1.5 text-sm" disabled={busy} onclick={onCancel}>
          Cancel
        </button>
        <button class="btn btn-danger px-3 py-1.5 text-sm" disabled={busy} onclick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}
