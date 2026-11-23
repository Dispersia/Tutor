<script lang="ts">
  /** The worn totals line: power, armour, each positive stat and the band buffs. */

  import { ACCENT, accentStyle } from '#lib/theme'
  import { STAT_LABEL, STAT_ORDER, combatBuffsOf, totalsOf } from '#lib/inventoryview'

  interface Props {
    totals: ReturnType<typeof totalsOf>
    combatBuffs: ReturnType<typeof combatBuffsOf>
  }

  let { totals, combatBuffs }: Props = $props()
</script>

<div class="mt-4 flex flex-wrap gap-1.5">
  <span class="chip" style={accentStyle(ACCENT.gold)}>⚔️ {totals.power} power</span>
  <span class="chip" style={accentStyle(ACCENT.azure)}>🛡️ {totals.armour} armour</span>
  {#each STAT_ORDER.filter((id) => totals.stats[id] > 0) as id (id)}
    <span class="chip" style={accentStyle(ACCENT.jade)}>+{totals.stats[id]} {STAT_LABEL[id]}</span>
  {/each}
</div>

{#if combatBuffs.length}
  <p class="mt-2 text-[11px] text-ink-400">
    Tier &amp; enchant bonuses
    {#each combatBuffs as b (b.stat)}
      <span style="color: var(--color-jade)"
        >+{b.stat === 'stamina' ? Math.round(b.v) : Math.round(b.v * 1000) / 10}{b.stat ===
        'stamina'
          ? ''
          : '%'}
        {b.stat}</span
      >
    {/each}
  </p>
{/if}
