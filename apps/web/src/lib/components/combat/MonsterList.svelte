<script lang="ts">
  import { href } from '#lib/paths'
  import { goto } from '$app/navigation'
  import { ACCENT, accentStyle, tierAccent } from '#lib/theme'
  import type { CombatResponse, MonsterDTO } from '#lib/combat'
  import type { ItemDTO, SkillsResponse } from '#lib/skills'

  interface Props {
    data: CombatResponse
    skillMap: Map<string, SkillsResponse['skills'][number]>
    itemMap: Map<string, ItemDTO>
    onFight: (m: MonsterDTO) => void
  }

  let { data, skillMap, itemMap, onFight }: Props = $props()

  const name = (id: string) => itemMap.get(id)?.name ?? id
  const icon = (id: string) => itemMap.get(id)?.icon ?? ''
</script>

{#if data.reviewCount === 0}
  <div class="panel mb-3 p-4 text-sm text-ink-300">
    Combat is review only — practise a few cards first, then come back to fight.
  </div>
{/if}
<div class="space-y-2 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0">
  {#each data.monsters as m (m.id)}
    <div class="panel panel-accent p-3" style={accentStyle(ACCENT.ember)}>
      <div class="flex items-center gap-3">
        <span class="text-2xl">{m.icon}</span>
        <div class="flex-1">
          <div class="flex items-baseline justify-between">
            <span class="display text-sm text-ink-200">{m.name}</span>
            <span class="text-xs text-ink-400">Lv {m.level} · {m.hp} HP · {m.damage} dmg</span>
          </div>
          <div class="text-xs text-ink-400">
            {m.description}
          </div>
          <div class="mt-1 flex flex-wrap gap-1">
            {#each m.drops as d (d.item)}
              <span class="chip" style={accentStyle(tierAccent(itemMap.get(d.item)?.tier))}>
                {icon(d.item)}
                {name(d.item)}
                {Math.round(d.chance * 100)}%
              </span>
            {/each}
          </div>
        </div>
        <button
          onclick={() => onFight(m)}
          disabled={!m.unlocked || data.reviewCount === 0}
          class="btn btn-ghost min-h-11 shrink-0 px-3 py-2 text-xs"
          style={accentStyle(ACCENT.ember)}
        >
          Fight
        </button>
      </div>
      {#if !m.unlocked}
        <p class="mt-1 text-xs text-brass-300">
          locked — {m.missing
            .map((r) => `${skillMap.get(r.skill)?.name ?? r.skill} ${r.level}`)
            .join(', ')}
          {m.equipMissing ? ` · equip a ${m.equipMissing.tag} ${m.equipMissing.slot}` : ''}
        </p>
      {/if}
    </div>
  {/each}
</div>
<div class="mt-4 grid grid-cols-2 gap-2">
  <button onclick={() => goto(href('/skills'))} class="btn btn-ghost py-3 text-xs">
    Gather & craft →
  </button>
  <button onclick={() => goto(href('/inventory'))} class="btn btn-ghost py-3 text-xs">
    Inventory →
  </button>
</div>
