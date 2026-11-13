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

<div class="flex items-center justify-between pt-5 pb-3">
  <div>
    <p class="eyebrow">Battle</p>
    <h1 class="display text-2xl text-combat-400">Combat</h1>
    <p class="text-xs text-ink-400">
      {encounter ? 'Answer drills to strike; a miss lets it hit back.' : 'Pick a monster to fight.'}
      · 🍤 {foodCount} food · 🧪 {potionCount} potions · auto-eat under {foodThreshold}%
    </p>
  </div>
  {#if data}
    <div class="flex shrink-0 flex-col items-end gap-1 text-xs">
      <span class="chip" style="--accent: #ef5f5a"
        >❤️ {encounter?.playerHp ?? data.player.maxHp} HP</span
      >
      <span class="chip" style="--accent: #6b7a96"
        >🛡️ {data.player.armour} · ⚔️ {data.player.weaponPower}</span
      >
    </div>
  {/if}
</div>

{#if error}
  <p class="mb-3 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>
{/if}

{#if loading}
  <p class="text-sm text-ink-400">Loading…</p>
{:else if encounter}
  <!-- active fight -->
  <div class="panel panel-accent mb-3 p-4" style="--accent: #ef5f5a">
    {#if drank}
      <p class="mb-2 text-xs text-sky-300">
        🧪 auto-drunk {name(drank.item)} at the start ({drank.buff.kind === 'power'
          ? `+${Math.round(drank.buff.value * 100)}% power`
          : `+${Math.round(drank.buff.value * 100)}% max HP`})
      </p>
    {/if}
    <div class="flex items-center justify-between text-sm">
      <span class="display text-ink-200">{encounter.monsterIcon} {encounter.monsterName}</span>
      <span class="text-ink-400">{encounter.monsterHp}/{encounter.monsterMaxHp}</span>
    </div>
    <div class="bar mt-1 mb-3" style="--accent: #ef5f5a">
      <i style="width: {(encounter.monsterHp / encounter.monsterMaxHp) * 100}%"></i>
    </div>
    <div class="flex items-center justify-between text-sm">
      <span class="display text-ink-200">🧑 You</span>
      <span class="text-ink-400">{encounter.playerHp}/{encounter.playerMaxHp}</span>
    </div>
    <div class="bar mt-1" style="--accent: #58c46b">
      <i style="width: {(encounter.playerHp / encounter.playerMaxHp) * 100}%"></i>
    </div>
  </div>

  {#if hit}
    <div class="mb-3 flex flex-wrap gap-2">
      {#if hit.correct}
        <span class="chip" style="--accent: #58c46b"> ⚔️ you hit for {hit.damage} </span>
      {:else}
        <span class="chip" style="--accent: #ef5f5a"> 💥 it hit you for {hit.playerDamage} </span>
      {/if}
      {#if hit.xp > 0}
        <span class="chip" style="--accent: #4fb0e8">
          {skillMap.get(monster?.combatSkill ?? '')?.icon ?? ''} +{hit.xp} xp
        </span>
      {/if}
      {#if hit.ate}
        <span class="chip" style="--accent: #ef9d45">
          🍤 auto-ate {name(hit.ate.item)} (+{hit.ate.heal})
        </span>
      {/if}
      {#if hit.talentUnlocked}
        <a
          href={href(`/skills/${monster?.combatSkill ?? ''}`)}
          class="chip"
          style="--accent: #e8c264"
        >
          🎉 Talent unlocked — choose one
        </a>
      {/if}
    </div>
  {/if}

  {#if hit && hit.outcome !== 'ongoing'}
    <div
      class="panel panel-accent p-5"
      style="--accent: {hit.outcome === 'won' ? '#58c46b' : '#ef5f5a'}"
    >
      <p class="display text-lg {hit.outcome === 'won' ? 'text-emerald-300' : 'text-red-300'}">
        {hit.outcome === 'won' ? '🏆 Victory!' : '💀 Defeated'}
      </p>
      {#if hit.drops.length}
        <p class="mt-2 text-sm text-ink-300">Loot:</p>
        <div class="mt-1 flex flex-wrap gap-2">
          {#each hit.drops as d (d.item)}
            <span class="chip" style="--accent: #58c46b">
              +{d.count}
              {icon(d.item)}
              {name(d.item)}
            </span>
          {/each}
        </div>
      {/if}
    </div>
    <button onclick={leave} class="btn btn-primary mt-4 w-full py-3">Back to monsters</button>
  {:else if instance}
    {@const Comp = componentFor(instance.exerciseId)}
    <div class="panel p-5">
      <Comp {instance} {busy} onsubmit={submit} />
    </div>
  {:else}
    <p class="text-sm text-ink-400">No drill available — try again.</p>
  {/if}
{:else}
  <!-- monster list -->
  <div class="space-y-2">
    {#each data?.monsters ?? [] as m (m.id)}
      <div class="panel p-3" class:opacity-70={!m.unlocked}>
        <div class="flex items-center gap-3">
          <span class="text-2xl">{m.icon}</span>
          <div class="flex-1">
            <div class="flex items-baseline justify-between">
              <span class="display text-sm text-ink-200">{m.name}</span>
              <span class="text-xs text-ink-400">Lv {m.level} · {m.hp} HP</span>
            </div>
            <div class="text-[11px] text-ink-400">
              {m.description} · trains {skillMap.get(m.combatSkill)?.name ?? m.combatSkill}
            </div>
            <div class="mt-1 flex flex-wrap gap-1">
              {#each m.drops as d (d.item)}
                <span class="chip" style="--accent: #6b7a96">
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
            class="btn shrink-0 px-3 py-2 text-sm"
            style="color:#08111b; background: #ef5f5a; border: 1px solid #b93b37"
          >
            Fight
          </button>
        </div>
        {#if !m.unlocked}
          <p class="mt-1 text-[11px] text-amber-300">
            locked — {m.missing
              .map((r) => `${skillMap.get(r.skill)?.name ?? r.skill} ${r.level}`)
              .join(', ')}
            {m.equipMissing ? ` · equip a ${m.equipMissing.tag} ${m.equipMissing.slot}` : ''}
          </p>
        {/if}
      </div>
    {/each}
  </div>
  <button onclick={() => goto(href('/skills'))} class="btn btn-ghost mt-4 w-full py-3">
    Gather & craft gear →
  </button>
{/if}
