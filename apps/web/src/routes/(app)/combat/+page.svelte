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
  import { accentStyle, tierAccent } from '#lib/theme'
  import { ACCENT } from '#lib/theme'
  import Icon from '#lib/components/Icon.svelte'
  import Spinner from '#lib/components/Spinner.svelte'

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

  /**
   * Enter fires the drill's primary action ("Got it", "Check") when the focus
   * is not in a text field, matching the practice screen. There is no result
   * screen here, the next instance arrives with the hit.
   */
  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.repeat || busy) return
    const t = e.target instanceof HTMLElement ? e.target : null
    if (t?.closest('input, textarea, select, a') || t?.isContentEditable) return
    const primary = document.querySelector<HTMLButtonElement>('[data-enter-action]:not(:disabled)')
    if (primary) {
      e.preventDefault()
      primary.click()
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="flex items-center justify-between border-b border-ink-700 pt-5 pb-3">
  <div>
    <h1 class="display text-3xl text-combat-400">Combat</h1>
    <p class="mt-1 text-xs text-ink-400">
      {encounter ? 'Answer drills to strike; a miss lets it hit back.' : 'Pick a monster to fight.'}
      · <Icon name="food" size={12} cls="align-[-2px]" />
      {foodCount} food ·
      <Icon name="potion" size={12} cls="align-[-2px]" />
      {potionCount} potions · auto-eat under {foodThreshold}%
    </p>
  </div>
  {#if data}
    <div class="flex shrink-0 flex-col items-end gap-1 text-xs">
      <span class="chip gap-1" style="--accent: {ACCENT.ember}"
        ><Icon name="heart" size={12} /> {encounter?.playerHp ?? data.player.maxHp} HP</span
      >
      <span class="chip gap-1" style="--accent: var(--color-ink-500)"
        ><Icon name="shield" size={12} />
        {data.player.armour} ·
        <Icon name="sword" size={12} />
        {data.player.weaponPower}</span
      >
    </div>
  {/if}
</div>

{#if error}
  <p class="mb-3 rounded-lg bg-ember-950 px-3 py-2 text-sm text-ember-300">{error}</p>
{/if}

{#if loading}
  <p class="flex items-center gap-2 text-sm text-ink-400">
    <Spinner size={14} label="Loading encounter" /> Loading…
  </p>
{:else if encounter}
  <!-- active fight -->
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
    <div class="flex items-center justify-between text-sm">
      <span class="display text-ink-200">You</span>
      <span class="text-ink-400">{encounter.playerHp}/{encounter.playerMaxHp}</span>
    </div>
    <div class="bar mt-1" style="--accent: {ACCENT.jade}">
      <i style="width: {(encounter.playerHp / encounter.playerMaxHp) * 100}%"></i>
    </div>
  </div>

  {#if hit}
    <div class="mb-3 flex flex-wrap gap-2">
      {#if hit.correct}
        <span class="chip gap-1" style="--accent: {ACCENT.jade}"
          ><Icon name="sword" size={12} /> you hit for {hit.damage}</span
        >
      {:else}
        <span class="chip gap-1" style="--accent: {ACCENT.ember}"
          ><Icon name="burst" size={12} /> it hit you for {hit.playerDamage}</span
        >
      {/if}
      {#if hit.xp > 0}
        <span class="chip" style="--accent: {ACCENT.azure}">
          {skillMap.get(monster?.combatSkill ?? '')?.icon ?? ''} +{hit.xp} xp
        </span>
      {/if}
      {#if hit.ate}
        <span class="chip gap-1" style="--accent: {ACCENT.brass}">
          <Icon name="food" size={12} /> auto-ate {name(hit.ate.item)} (+{hit.ate.heal})
        </span>
      {/if}
      {#if hit.talentUnlocked}
        <a
          href={href(`/skills/${monster?.combatSkill ?? ''}`)}
          class="chip"
          style="--accent: {ACCENT.gold}"
        >
          Talent unlocked — choose one
        </a>
      {/if}
    </div>
  {/if}

  {#if hit && hit.outcome !== 'ongoing'}
    <div
      class="panel panel-accent p-5"
      style="--accent: {hit.outcome === 'won' ? ACCENT.jade : ACCENT.ember}"
    >
      <p
        class="display flex items-center gap-2 text-lg {hit.outcome === 'won'
          ? 'text-jade-300'
          : 'text-ember-300'}"
      >
        <Icon name={hit.outcome === 'won' ? 'trophy' : 'skull'} size={18} />
        {hit.outcome === 'won' ? 'Victory!' : 'Defeated'}
      </p>
      {#if hit.drops.length}
        <p class="mt-2 text-sm text-ink-300">Loot:</p>
        <div class="mt-1 flex flex-wrap gap-2">
          {#each hit.drops as d (d.item)}
            <span class="chip" style={accentStyle(tierAccent(itemMap.get(d.item)?.tier))}>
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
    <!-- Key on the instance so a fresh drill remounts the component. Otherwise
         two same-type drills in a row reuse it and keep the last answer text. -->
    {#key instance}
      {@const Comp = componentFor(instance.exerciseId)}
      <div class="panel p-5">
        <Comp {instance} {busy} onsubmit={submit} />
      </div>
    {/key}
  {:else}
    <p class="text-sm text-ink-400">No drill available — try again.</p>
  {/if}
{:else}
  <!-- monster list -->
  <div class="space-y-2">
    {#each data?.monsters ?? [] as m (m.id)}
      <div
        class="panel panel-accent p-3"
        class:opacity-70={!m.unlocked}
        style={accentStyle(ACCENT.ember)}
      >
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
                <span class="chip" style={accentStyle(tierAccent(itemMap.get(d.item)?.tier))}>
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
            class="btn btn-accent shrink-0 px-3 py-2 text-sm"
            style={accentStyle(ACCENT.ember)}
          >
            Fight
          </button>
        </div>
        {#if !m.unlocked}
          <p class="mt-1 text-[11px] text-brass-300">
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
