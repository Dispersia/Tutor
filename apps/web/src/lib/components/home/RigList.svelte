<script lang="ts">
  /** The running idle rigs: what is accumulating right now, busiest first. */

  import { fmtClock } from '#lib/idle'
  import { href } from '#lib/paths'
  import { ACCENT, accentStyle } from '#lib/theme'
  import type { RigRow } from '#lib/homeview'

  interface Props {
    rigs: RigRow[]
  }

  let { rigs }: Props = $props()
</script>

<section
  class="panel panel-accent mt-4 p-4"
  style={accentStyle(ACCENT.jade)}
  aria-label="Running rigs"
>
  <div class="flex items-baseline justify-between gap-3">
    <h2 class="eyebrow" style="color: var(--accent)">Rigs</h2>
    <span class="text-xs text-ink-400">
      {#if rigs.length}
        {rigs.length} running
      {:else}
        idle
      {/if}
    </span>
  </div>

  {#if rigs.length}
    <ul class="mt-1">
      {#each rigs as r (r.actionId)}
        <li class="flex items-center gap-3 border-b border-ink-700 py-2.5 last:border-0">
          <span class="w-5 shrink-0 text-center text-base" aria-hidden="true">{r.icon}</span>
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline justify-between gap-2">
              <a
                href={href(`/skills/${r.skillId}#action-${r.actionId}`)}
                class="truncate text-sm text-ink-200 hover:underline">{r.actionName}</a
              >
              <span class="flex shrink-0 items-baseline gap-2">
                <span
                  class="display text-xs font-bold text-gold-200 tabular-nums"
                  title="Action XP this rig earns per item">+{r.xpPerCraft} xp</span
                >
                <span
                  class="display text-sm font-bold tabular-nums"
                  style="color: {r.category.accent}">{r.rate}</span
                >
              </span>
            </div>
            <div class="mt-0.5 flex items-baseline justify-between gap-2 text-xs text-ink-400">
              <span class="truncate">{r.yields || '—'}</span>
              <span class="shrink-0 tabular-nums">{fmtClock(r.left)} left</span>
            </div>
            <div class="bar mt-1.5 h-1" role="progressbar" aria-label="Rig run remaining">
              <i style="width: {r.runPct * 100}%; background: {r.category.accent}"></i>
            </div>
          </div>
          <span
            class="display shrink-0 text-sm font-bold text-gold-200 tabular-nums"
            title="Gathered since you opened this page">+{r.made}</span
          >
        </li>
      {/each}
    </ul>
  {:else}
    <p class="mt-2 text-xs text-ink-400">
      No rigs running — complete a drill in <a href={href('/skills')} class="link">Skills</a> to power
      one, then leave it be.
    </p>
  {/if}
</section>
