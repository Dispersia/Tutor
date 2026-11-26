<script lang="ts">
  import { accentStyle, ACCENT } from '#lib/theme'
  import { haptics, vibrationSupported } from '#lib/haptics.svelte'

  interface Props {
    value: number
    onSave: (value: number) => void
  }

  let { value = $bindable(), onSave }: Props = $props()

  const LEVELS = ['Off', 'Very light', 'Light', 'Medium', 'Strong', 'Very strong']
  const supported = vibrationSupported()
  let status = $state('')

  function test() {
    status = haptics.preview(value)
      ? 'Vibration sent to the phone.'
      : 'The browser blocked the vibration.'
  }
</script>

<section class="mb-5 panel panel-accent p-4" style={accentStyle(ACCENT.jade)}>
  <h2 class="display text-sm text-ink-100">Keyboard</h2>
  <p class="mt-1 text-xs text-ink-400">
    Vibration on every key press. Slide all the way down to turn it off. Works on Android; iOS
    ignores it.
  </p>
  <div class="mt-3 flex items-center gap-3">
    <input type="range" min="0" max="5" step="1" bind:value class="flex-1" />
    <span class="w-20 text-xs text-ink-300">{LEVELS[value] ?? 'Off'}</span>
    <button
      type="button"
      class="btn btn-ghost px-3 py-2 text-xs"
      disabled={value === 0}
      onclick={test}
    >
      Test
    </button>
    <button onclick={() => onSave(value)} class="btn btn-ghost px-3 py-2 text-xs">Save</button>
  </div>
  <p class="mt-2 text-xs text-ink-500">
    {#if !supported}
      This browser has no vibration API, so the setting has no effect here.
    {:else if status}
      {status}
    {:else}
      Vibration API available on this device.
    {/if}
  </p>
</section>
