<script lang="ts">
  import { href } from '#lib/paths'
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { componentFor } from '#lib/components/exercises'
  import { api } from '#lib/api'
  import {
    combatHit,
    getCombat,
    startFight,
    type CombatResponse,
    type EncounterDTO,
    type HitResult,
    type MonsterDTO,
  } from '#lib/combat'
  import type { Grade, Instance } from '#lib/exercises'
  import { getSkills, type SkillsResponse } from '#lib/skills'

  let data = $state<CombatResponse | null>(null)
  let ref = $state<SkillsResponse | null>(null)
  let encounter = $state<EncounterDTO | null>(null)
  let instance = $state<Instance | null>(null)
  let monster = $state<MonsterDTO | null>(null)
  let result = $state<Grade | null>(null)
  let hit = $state<HitResult | null>(null)
  let drank = $state<{ item: string; buff: { kind: string; value: number } } | null>(null)
  let foodThreshold = $state(50)
  let busy = $state(false)
  let error = $state('')
  let loading = $state(true)

  const itemMap = $derived(new Map((ref?.items ?? []).map((i) => [i.id, i])))
  const skillMap = $derived(new Map((ref?.skills ?? []).map((s) => [s.id, s])))
  const name = (id: string) => itemMap.get(id)?.name ?? id
  const icon = (id: string) => itemMap.get(id)?.icon ?? ''
  const foodCount = $derived(
    (ref?.inventory ?? []).reduce(
      (n, i) => n + ((itemMap.get(i.itemId)?.heal ?? 0) > 0 ? i.count : 0),
      0,
    ),
  )
  const potionCount = $derived(
    (ref?.inventory ?? []).reduce((n, i) => n + (itemMap.get(i.itemId)?.buff ? i.count : 0), 0),
  )

  onMount(refresh)

  async function refresh() {
    try {
      const [c, s, set] = await Promise.all([
        getCombat(),
        getSkills().catch(() => null),
        api<{ foodThreshold?: number }>('/api/settings').catch(() => null),
      ])
      data = c
      ref = s
      encounter = c.encounter
      if (set?.foodThreshold) foodThreshold = set.foodThreshold
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  }

  async function fight(m: MonsterDTO) {
    error = ''
    try {
      const r = await startFight(m.id)
      monster = r.monster
      encounter = r.encounter
      instance = r.instance
      drank = r.drank
      result = null
      hit = null
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function submit(answer: unknown) {
    if (!instance) return
    busy = true
    error = ''
    try {
      const r = await combatHit({
        exerciseId: instance.exerciseId,
        cardId: instance.cardId,
        answer,
      })
      result = r.result
      hit = r.hit
      encounter = r.encounter
      instance = r.instance
      if (r.hit.outcome !== 'ongoing') {
        // fight over — refresh the monster list / bank
        void refresh()
      }
    } catch (e) {
      error = (e as Error).message
    } finally {
      busy = false
    }
  }

  function leave() {
    encounter = null
    instance = null
    monster = null
    result = null
    hit = null
    drank = null
    void refresh()
  }
</script>

<div class="flex items-center justify-between pt-4 pb-3">
  <div>
    <h1 class="text-lg font-semibold">Combat</h1>
    <p class="text-xs text-neutral-500">
      {encounter ? 'Answer drills to strike; a miss lets it hit back.' : 'Pick a monster to fight.'}
      · 🍤 {foodCount} food · 🧪 {potionCount} potions · auto-eat under {foodThreshold}%
    </p>
  </div>
  {#if data}
    <div class="text-right text-xs text-neutral-400">
      <div>❤️ {encounter?.playerHp ?? data.player.maxHp} HP</div>
      <div>🛡️ {data.player.armour} · ⚔️ {data.player.weaponPower}</div>
    </div>
  {/if}
</div>

{#if error}
  <p class="mb-3 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>
{/if}

{#if loading}
  <p class="text-sm text-neutral-500">Loading…</p>
{:else if encounter}
  <!-- active fight -->
  <div class="mb-3 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
    {#if drank}
      <p class="mb-2 text-xs text-sky-300">
        🧪 auto-drunk {name(drank.item)} at the start ({drank.buff.kind === 'power'
          ? `+${Math.round(drank.buff.value * 100)}% power`
          : `+${Math.round(drank.buff.value * 100)}% max HP`})
      </p>
    {/if}
    <div class="flex items-center justify-between text-sm">
      <span>{encounter.monsterIcon} {encounter.monsterName}</span>
      <span class="text-neutral-400">{encounter.monsterHp}/{encounter.monsterMaxHp}</span>
    </div>
    <div class="mt-1 h-2 overflow-hidden rounded-full bg-neutral-800">
      <div
        class="h-full rounded-full bg-red-500 transition-all"
        style="width: {(encounter.monsterHp / encounter.monsterMaxHp) * 100}%"
      ></div>
    </div>
    <div class="mt-3 flex items-center justify-between text-sm">
      <span>🧑 You</span>
      <span class="text-neutral-400">{encounter.playerHp}/{encounter.playerMaxHp}</span>
    </div>
    <div class="mt-1 h-2 overflow-hidden rounded-full bg-neutral-800">
      <div
        class="h-full rounded-full bg-emerald-500 transition-all"
        style="width: {(encounter.playerHp / encounter.playerMaxHp) * 100}%"
      ></div>
    </div>
  </div>

  {#if hit}
    <div class="mb-3 flex flex-wrap gap-2 text-xs">
      {#if hit.correct}
        <span class="rounded-lg bg-emerald-900/40 px-2 py-1 text-emerald-200">
          ⚔️ you hit for {hit.damage}
        </span>
      {:else}
        <span class="rounded-lg bg-red-900/40 px-2 py-1 text-red-200">
          💥 it hit you for {hit.playerDamage}
        </span>
      {/if}
      {#if hit.xp > 0}
        <span class="rounded-lg bg-sky-900/40 px-2 py-1 text-sky-200">
          {skillMap.get(monster?.combatSkill ?? '')?.icon ?? ''} +{hit.xp} xp
        </span>
      {/if}
      {#if hit.ate}
        <span class="rounded-lg bg-amber-900/40 px-2 py-1 text-amber-200">
          🍤 auto-ate {name(hit.ate.item)} (+{hit.ate.heal})
        </span>
      {/if}
      {#each hit.grantedTalents as t (t.id)}
        <span class="rounded-lg bg-amber-900/40 px-2 py-1 text-amber-200">🏅 {t.name}</span>
      {/each}
    </div>
  {/if}

  {#if hit && hit.outcome !== 'ongoing'}
    <div
      class="rounded-2xl border p-5 {hit.outcome === 'won'
        ? 'border-emerald-800 bg-emerald-950/40'
        : 'border-red-800 bg-red-950/30'}"
    >
      <p class="text-lg font-medium">{hit.outcome === 'won' ? '🏆 Victory!' : '💀 Defeated'}</p>
      {#if hit.drops.length}
        <p class="mt-2 text-sm text-neutral-300">Loot:</p>
        <div class="mt-1 flex flex-wrap gap-2 text-xs">
          {#each hit.drops as d (d.item)}
            <span class="rounded-lg bg-emerald-900/40 px-2 py-1 text-emerald-200">
              +{d.count}
              {icon(d.item)}
              {name(d.item)}
            </span>
          {/each}
        </div>
      {/if}
    </div>
    <button
      onclick={leave}
      class="mt-4 w-full rounded-xl bg-emerald-500 py-3 font-medium text-black"
      >Back to monsters</button
    >
  {:else if instance}
    {@const Comp = componentFor(instance.exerciseId)}
    <div class="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
      <Comp {instance} {busy} onsubmit={submit} />
    </div>
  {:else}
    <p class="text-sm text-neutral-500">No drill available — try again.</p>
  {/if}
{:else}
  <!-- monster list -->
  <div class="space-y-2">
    {#each data?.monsters ?? [] as m (m.id)}
      <div class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-3">
        <div class="flex items-center gap-3">
          <span class="text-2xl">{m.icon}</span>
          <div class="flex-1">
            <div class="flex items-baseline justify-between">
              <span class="text-sm font-medium">{m.name}</span>
              <span class="text-xs text-neutral-400">Lv {m.level} · {m.hp} HP</span>
            </div>
            <div class="text-[11px] text-neutral-500">
              {m.description} · trains {skillMap.get(m.combatSkill)?.name ?? m.combatSkill}
            </div>
            <div class="mt-1 flex flex-wrap gap-1 text-[11px]">
              {#each m.drops as d (d.item)}
                <span class="rounded bg-neutral-800 px-1.5 py-0.5">
                  {icon(d.item)}
                  {name(d.item)}
                  {Math.round(d.chance * 100)}%
                </span>
              {/each}
            </div>
          </div>
          <button
            onclick={() => fight(m)}
            disabled={!m.unlocked}
            class="shrink-0 rounded-xl bg-emerald-500 px-3 py-2 text-sm text-black disabled:opacity-40"
          >
            Fight
          </button>
        </div>
        {#if !m.unlocked}
          <p class="mt-1 text-[11px] text-amber-400">
            locked — {m.missing
              .map((r) => `${skillMap.get(r.skill)?.name ?? r.skill} ${r.level}`)
              .join(', ')}
            {m.equipMissing ? ` · equip a ${m.equipMissing.tag} ${m.equipMissing.slot}` : ''}
          </p>
        {/if}
      </div>
    {/each}
  </div>
  <button
    onclick={() => goto(href('/skills'))}
    class="mt-4 w-full rounded-xl border border-neutral-700 py-3 text-sm"
    >Gather & craft gear →</button
  >
{/if}
