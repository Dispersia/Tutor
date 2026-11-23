<script lang="ts">
  import { ACCENT, accentStyle } from '#lib/theme'
  import type { GearResponse } from '#lib/skills'

  interface Props {
    bonuses: NonNullable<GearResponse['setBonuses']>
  }

  let { bonuses }: Props = $props()
</script>

{#if bonuses.length > 0}
  <section class="mt-4" style={accentStyle(ACCENT.violet)}>
    <h2 class="eyebrow" style="color: var(--accent)">Set bonuses</h2>
    <div class="mt-2 grid gap-2 sm:grid-cols-2">
      {#each bonuses as set (set.id)}
        <div class="panel p-3" style={accentStyle(ACCENT.violet)}>
          <div class="flex items-center justify-between gap-2">
            <p class="display text-sm text-ink-100">
              {set.name}
              <span class="text-ink-400">({set.pieces})</span>
            </p>
            <span class="chip text-[10px]" style={accentStyle(ACCENT.violet)}>{set.armourType}</span
            >
          </div>
          {#if set.active.length > 0}
            <p class="mt-1 text-[11px] text-ink-300">
              {set.active.map((tier) => tier.label).join(' · ')}
            </p>
          {:else}
            <p class="mt-1 text-[11px] text-ink-400">No bonus yet.</p>
          {/if}
          {#if set.next}
            <p class="mt-1 text-[10px] text-ink-500">
              Next at {set.next.pieces}: {set.next.label}
            </p>
          {/if}
        </div>
      {/each}
    </div>
  </section>
{/if}
