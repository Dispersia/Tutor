<script lang="ts">
  /** The drill itself: the exercise component, its speech warm-up and the mute hint. */

  import { componentFor } from '#lib/components/exercises'
  import Icon from '#lib/components/Icon.svelte'
  import Spinner from '#lib/components/Spinner.svelte'
  import type { Instance } from '#lib/exercises'

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
<div class="panel p-5">
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
</div>
