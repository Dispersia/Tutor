<script lang="ts">
  import { componentFor } from '#lib/components/exercises'
  import Icon from '#lib/components/Icon.svelte'
  import Spinner from '#lib/components/Spinner.svelte'
  import type { Instance } from '#lib/exercises'
  import { ACCENT } from '#lib/theme'

  interface Props {
    instance: Instance
    busy: boolean
    needsSpeech: boolean
    speechWarm: 'idle' | 'warming' | 'ready' | 'error'
    onsubmit: (answer: unknown) => void
    onspeak: (blob: Blob) => void
    onQuiet: (enabled: boolean) => void
  }

  let { instance, busy, needsSpeech, speechWarm, onsubmit, onspeak, onQuiet }: Props = $props()

  const Comp = $derived(componentFor(instance.exerciseId))
</script>

{#if needsSpeech && speechWarm !== 'ready'}
  <p
    class="mb-2 flex items-center gap-2 text-xs {speechWarm === 'error'
      ? 'text-ember-300'
      : 'text-ink-400'}"
  >
    {#if speechWarm === 'error'}
      Speech model didn’t start — audio may be unavailable.
    {:else}
      <Spinner size={12} label="Starting the speech model" /> Starting the speech model…
    {/if}
  </p>
{/if}
<div class="panel relative p-5">
  <Comp {instance} {busy} {onsubmit} {onspeak} />
  {#if instance.modality === 'voice'}
    <button
      type="button"
      onclick={() => onQuiet(true)}
      class="btn btn-ghost mt-4 w-full py-2.5 text-xs"
      title="Hide listen/speak cards for 15 minutes"
    >
      <Icon name="mute" size={13} /> I can’t speak or listen right now — hide these for 15 min
    </button>
  {/if}
  {#if busy}
    <div
      class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-ink-850"
      style="--accent: {ACCENT.azure}"
      aria-busy="true"
    >
      <Spinner size={32} label="Checking your answer" />
      <p class="text-sm text-ink-400">Checking your answer…</p>
    </div>
  {/if}
</div>
