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

  const toFull = $derived(Math.max(0, idle.maxRunSec - idle.secondsLeft))
</script>

<div class="panel panel-accent mb-3 p-3" style="--accent: {accent}">
  <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
    <span class="text-ink-300">
      Rig powered ·
      <span class="display tabular-nums" style="color: {accent}"
        >{fmtInterval(idle.intervalSec)}</span
      >
      ·
      <span class="display tabular-nums" style="color: {accent}">{fmtClock(idle.secondsLeft)}</span>
      left · +{idle.xpPerCraft} xp/item
    </span>
    <span class="display tabular-nums text-ink-300">
      {idle.maxed ? 'maxed' : `${Math.round(idle.runProgress * 100)}%`}
    </span>
  </div>
  <div
    class="bar mt-2 h-1.5"
    role="progressbar"
    aria-label="Rig run filled toward the {fmtClock(idle.maxRunSec)} cap"
    aria-valuenow={Math.round(idle.runProgress * 100)}
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <i style="width: {idle.runProgress * 100}%; background: {accent}"></i>
  </div>
  {#if idle.maxed}
    <p class="mt-2 text-xs text-jade-300">
      Full at {fmtClock(idle.maxRunSec)} — the run is as long as it gets. Switch to another action to
      power a fresh one.
    </p>
  {:else}
    <p class="mt-2 text-xs text-ink-400">
      {fmtClock(toFull)} of run left to add before this rig is full at {fmtClock(idle.maxRunSec)}.
    </p>
  {/if}
  <p class="mt-2 text-xs text-ink-400">
    {rigsRunning}/{maxLiveRigs} rigs running — only two run at once.
    {#if stoppedName}
      This drill stopped {stoppedName}.
    {/if}
  </p>
</div>
