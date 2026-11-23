<script lang="ts">
  import { ACCENT } from '#lib/theme'
  import Icon from '#lib/components/Icon.svelte'
  import type { EncounterDTO, HitResult } from '#lib/combat'
  import type { ItemDTO } from '#lib/skills'

  interface Props {
    encounter: EncounterDTO
    hit: HitResult | null
    justHit: boolean
    hitSeq: number
    drank: { item: string; buff: { kind: string; value: number } } | null
    itemMap: Map<string, ItemDTO>
    busy: boolean
    onFlee: () => void
  }

  let { encounter, hit, justHit, hitSeq, drank, itemMap, busy, onFlee }: Props = $props()

  const name = (id: string) => itemMap.get(id)?.name ?? id
</script>

<div class="panel panel-accent mb-3 p-4" style="--accent: {ACCENT.ember}">
  {#if drank}
    <p class="mb-2 flex items-center gap-1.5 text-xs text-sky-300">
      <Icon name="potion" size={13} /> auto-drunk {name(drank.item)} at the start ({drank.buff
        .kind === 'power'
        ? `+${Math.round(drank.buff.value * 100)}% power`
        : `+${Math.round(drank.buff.value * 100)}% max HP`})
    </p>
  {/if}
  <div class="flex items-center justify-between text-sm">
    <span class="display text-ink-200">{encounter.monsterIcon} {encounter.monsterName}</span>
    <span class="text-ink-400">{encounter.monsterHp}/{encounter.monsterMaxHp}</span>
  </div>
  <div class="bar mt-1 mb-3" style="--accent: {ACCENT.ember}">
    <i style="width: {(encounter.monsterHp / encounter.monsterMaxHp) * 100}%"></i>
  </div>
  {#key hitSeq}
    <div class="relative" class:hit-shake={justHit}>
      <div class="flex items-center justify-between text-sm">
        <span class="display text-ink-200">You</span>
        <span class="text-ink-400">{encounter.playerHp}/{encounter.playerMaxHp}</span>
      </div>
      <div class="bar mt-1" style="--accent: {justHit ? ACCENT.ember : ACCENT.jade}">
        <i style="width: {(encounter.playerHp / encounter.playerMaxHp) * 100}%"></i>
      </div>
      {#if justHit}
        <span
          class="damage-float pointer-events-none absolute -top-4 right-0 text-sm font-semibold text-ember-300"
        >
          -{hit?.playerDamage ?? 0}
        </span>
      {/if}
    </div>
  {/key}
  <div class="mt-3 flex justify-end">
    <button onclick={onFlee} disabled={busy} class="btn btn-ghost px-3 py-1.5 text-xs">
      Leave fight
    </button>
  </div>
</div>
