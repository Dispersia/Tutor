<script lang="ts">
  /** A single numeric tuning knob: a small panel with one number field and Save. */

  import { accentStyle } from '#lib/theme'

  interface Props {
    title: string
    help: string
    min: number
    max: number
    step: number
    suffix?: string
    inputWidth?: string
    accent: string
    value: number
    onSave: () => void
  }

  let {
    title,
    help,
    min,
    max,
    step,
    suffix = '',
    inputWidth = 'w-24',
    accent,
    value = $bindable(),
    onSave,
  }: Props = $props()
</script>

<section class="mb-5 panel panel-accent p-4" style={accentStyle(accent)}>
  <h2 class="display text-sm text-ink-100">{title}</h2>
  <p class="mt-1 text-xs text-ink-400">{help}</p>
  <div class="mt-3 flex items-center gap-2">
    <input type="number" {min} {max} {step} bind:value class="field {inputWidth}" />
    {#if suffix}<span class="text-sm text-ink-400">{suffix}</span>{/if}
    <button onclick={onSave} class="btn btn-ghost px-3 py-2 text-xs">Save</button>
  </div>
</section>
