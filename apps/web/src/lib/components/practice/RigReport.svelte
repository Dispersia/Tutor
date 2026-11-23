<script lang="ts">
  import { fmtClock, fmtInterval } from '#lib/idle'
  import type { SkillOutcome } from '#lib/skills'

  interface Props {
    idle: NonNullable<SkillOutcome['idle']>
    accent: string
    rigsRunning: number
    maxLiveRigs: number
    stoppedName?: string
  }

  let { idle, accent, rigsRunning, maxLiveRigs, stoppedName }: Props = $props()

  const remaining = $derived(idle.runFullAtCompletions - idle.completions)
</script>

<div class="panel panel-accent mb-3 p-3" style="--accent: {accent}">
  <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
    <span class="text-ink-300">
      Rig powered ·
      <span class="display tabular-nums" style="color: {accent}"
        >{fmtInterval(idle.intervalSec)}</span
      >
      ·
      <span class="display tabular-nums" style="color: {accent}">{fmtClock(idle.runSec)}</span>
      run · +{idle.xpPerCraft} xp/item
    </span>
    <span class="display tabular-nums text-ink-300">
      {idle.maxed ? 'maxed' : `${idle.completions}/${idle.runFullAtCompletions}`}
    </span>
  </div>
  <div
    class="bar mt-2 h-1.5"
    role="progressbar"
    aria-label="Rig progress toward the {fmtClock(idle.maxRunSec)} run cap"
    aria-valuenow={Math.round(idle.runProgress * 100)}
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <i style="width: {idle.runProgress * 100}%; background: {accent}"></i>
  </div>
  {#if idle.maxed}
    <p class="mt-2 text-xs text-jade-300">
      Maxed at {fmtClock(idle.maxRunSec)} — this rig runs as long and as fast as it ever will. Switch
      to another action to power a fresh one.
    </p>
  {:else}
    <p class="mt-2 text-xs text-ink-400">
      {remaining}
      {remaining === 1 ? 'drill' : 'drills'} to the full
      {fmtClock(idle.maxRunSec)} run.
    </p>
  {/if}
  <p class="mt-2 text-xs text-ink-400">
    {rigsRunning}/{maxLiveRigs} rigs running — only two run at once.
    {#if stoppedName}
      This drill stopped {stoppedName}.
    {/if}
  </p>
</div>
