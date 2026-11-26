<script lang="ts">
  import { onMount } from 'svelte'
  import { componentFor } from '#lib/components/exercises'
  import { api } from '#lib/api'
  import {
    abandonFight,
    combatHit,
    COMBAT_TIME_LIMIT_MS,
    startFight,
    type CombatResponse,
    type EncounterDTO,
    type HitResult,
    type MonsterDTO,
  } from '#lib/combat'
  import type { Instance } from '#lib/exercises'
  import { useSkills } from '#lib/skills/store.svelte'
  import { ACCENT } from '#lib/theme'
  import Icon from '#lib/components/Icon.svelte'
  import Spinner from '#lib/components/Spinner.svelte'
  import FightBoard from '#lib/components/combat/FightBoard.svelte'
  import HitReport from '#lib/components/combat/HitReport.svelte'
  import MonsterList from '#lib/components/combat/MonsterList.svelte'
  import OutcomePanel from '#lib/components/combat/OutcomePanel.svelte'
  import ConfirmDialog from '#lib/components/ConfirmDialog.svelte'
  import { primaryActionButton } from '#lib/components/enterSubmit'
  import { haptics } from '#lib/haptics.svelte'
  import { peekCached } from '#lib/cache'
  import { countConsumables } from '#lib/combatview'
  import { cachedResource } from '#lib/resource.svelte'

  const combat = cachedResource<CombatResponse>('/api/combat', { auto: false })
  const board = useSkills()
  const data = $derived(combat.data ?? null)
  let encounter = $state<EncounterDTO | null>(combat.data?.encounter ?? null)
  let instance = $state<Instance | null>(combat.data?.instance ?? null)
  let hit = $state<HitResult | null>(null)
  let drank = $state<{ item: string; buff: { kind: string; value: number } } | null>(null)
  let foodThreshold = $state(50)
  let foodNote = $state('')
  let pendingFlee = $state(false)
  let busy = $state(false)
  let timerStarted = $state(false)
  let deadline = $state(0)
  let now = $state(Date.now())
  let timeoutFired = $state(false)
  let hitSeq = $state(0)
  let justHit = $state(false)
  const timeLeft = $derived(Math.max(0, deadline - now))
  const timeLeftSec = $derived(Math.ceil(timeLeft / 1000))
  const timePct = $derived(
    deadline > 0 ? Math.max(0, Math.min(100, (timeLeft / COMBAT_TIME_LIMIT_MS) * 100)) : 0,
  )

  const itemMap = $derived(board.itemMap)
  const skillMap = $derived(board.skillMap)
  const fightSkill = $derived(skillMap.get(data?.player.skill ?? '')?.name ?? '')
  const fightSkillIcon = $derived(skillMap.get(data?.player.skill ?? '')?.icon ?? '')
  const consumables = $derived(countConsumables(board.inventory, itemMap))
  const foodCount = $derived(consumables.food)
  const potionCount = $derived(consumables.potions)

  onMount(() => {
    void haptics.ensure()
    void loadFoodThreshold()
    void refresh()
  })

  async function loadFoodThreshold() {
    const cached = peekCached<{ foodThreshold?: number }>('/api/settings')
    if (cached?.foodThreshold !== undefined) {
      foodThreshold = cached.foodThreshold
      return
    }
    try {
      const s = await api<{ foodThreshold?: number }>('/api/settings')
      if (s.foodThreshold !== undefined) foodThreshold = s.foodThreshold
    } catch {
      foodNote = 'Settings didn’t load — using the default.'
    }
  }

  $effect(() => {
    if (!timerStarted) return
    const timer = setInterval(() => (now = Date.now()), 100)
    return () => clearInterval(timer)
  })

  $effect(() => {
    if (!timerStarted || deadline === 0 || timeoutFired) return
    if (now < deadline) return
    timeoutFired = true
    if (busy) return
    void submit(null, true)
  })

  function startTimer() {
    now = Date.now()
    deadline = now + COMBAT_TIME_LIMIT_MS
    timeoutFired = false
    timerStarted = true
  }

  function stopTimer() {
    timerStarted = false
    deadline = 0
    timeoutFired = false
  }

  async function refresh() {
    const [ok] = await Promise.all([combat.refresh(), board.refresh()])
    if (ok && combat.data) applyCombat(combat.data)
  }

  function applyCombat(c: CombatResponse) {
    if (!hit || hit.outcome === 'ongoing') encounter = c.encounter
    if (c.encounter) {
      instance = c.instance
      stopTimer()
    }
    justHit = false
  }

  async function fight(m: MonsterDTO) {
    combat.error = ''
    stopTimer()
    try {
      const r = await startFight(m.id)
      encounter = r.encounter
      instance = r.instance
      drank = r.drank
      hit = null
      justHit = false
    } catch (e) {
      combat.error = (e as Error).message
    }
  }

  async function submit(answer: unknown, timedOut = false) {
    if (!instance || busy) return
    if (!timedOut) haptics.pulse()
    busy = true
    combat.error = ''
    try {
      applyHit(await combatHit(hitBody(answer, timedOut)))
    } catch (e) {
      combat.error = (e as Error).message
      stopTimer()
    } finally {
      busy = false
    }
  }

  function hitBody(answer: unknown, timedOut: boolean): Parameters<typeof combatHit>[0] {
    return {
      exerciseId: instance!.exerciseId,
      cardId: instance!.cardId,
      answer,
      timedOut,
    }
  }

  function finalState(last: typeof encounter, h: HitResult): typeof encounter {
    return last && { ...last, monsterHp: h.monsterHp, playerHp: h.playerHp }
  }

  function applyHit(r: Awaited<ReturnType<typeof combatHit>>) {
    hit = r.hit
    justHit = r.hit.playerDamage > 0
    if (r.hit.playerDamage > 0) hitSeq += 1
    encounter = r.encounter ?? finalState(encounter, r.hit)
    instance = r.instance
    if (r.hit.outcome !== 'ongoing') {
      stopTimer()
      void refresh()
    } else if (r.instance) {
      startTimer()
    } else {
      stopTimer()
    }
  }

  function leave() {
    stopTimer()
    encounter = null
    instance = null
    hit = null
    drank = null
    justHit = false
    void refresh()
  }

  function flee() {
    if (busy) return
    pendingFlee = true
  }

  async function confirmFlee() {
    pendingFlee = false
    busy = true
    combat.error = ''
    try {
      await abandonFight()
      leave()
    } catch (e) {
      combat.error = (e as Error).message
    } finally {
      busy = false
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (busy) return
    const primary = primaryActionButton(e)
    if (!primary) return
    e.preventDefault()
    primary.click()
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="lg:mx-auto lg:max-w-3xl">
  <div class="border-b border-ink-700 pt-4 pb-4 mb-4">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h1 class="display text-3xl text-ink-100">Combat</h1>
        <p class="sub mt-2">
          {encounter
            ? 'Answer drills to strike; it hits you every exchange.'
            : 'Pick a monster to fight.'}
        </p>
      </div>
      {#if data}
        <div class="shrink-0 text-center">
          <div
            class="seal h-14 w-14"
            style="--seal-accent: {ACCENT.ember}"
            role="img"
            aria-label="Your hit points {encounter?.playerHp ?? data.player.hp}"
          >
            <span class="display text-lg leading-none font-bold"
              >{encounter?.playerHp ?? data.player.hp}</span
            >
          </div>
          <p class="seal__label" aria-hidden="true">HP</p>
        </div>
      {/if}
    </div>
    {#if data}
      <div class="mt-3 flex flex-wrap items-center gap-1.5">
        {#if fightSkill}
          <span class="chip gap-1" style="--accent: {ACCENT.ember}">
            {fightSkillIcon}
            {fightSkill}
          </span>
        {/if}
        <span class="chip gap-1" style="--accent: {ACCENT.gold}">
          <Icon name="food" size={12} />
          {foodCount} food
        </span>
        <span class="chip gap-1" style="--accent: {ACCENT.azure}">
          <Icon name="potion" size={12} />
          {potionCount} potions
        </span>
        <span class="chip gap-1" style="--accent: var(--color-ink-500)">
          <Icon name="shield" size={12} />
          {data.player.armour} ·
          <Icon name="sword" size={12} />
          {data.player.power}
        </span>
        <span class="chip" style="--accent: {ACCENT.ember}">
          🎯 {Math.round(data.player.crit * 100)}% crit
        </span>
        <span class="chip" style="--accent: {ACCENT.azure}">
          ⚡ {Math.round(data.player.haste * 100)}% haste
        </span>
        <span class="chip" style="--accent: {ACCENT.violet}">
          ✦ {Math.round(data.player.mastery * 100)}% mastery
        </span>
        {#if (data.player.lifesteal ?? 0) > 0}
          <span class="chip" style="--accent: {ACCENT.jade}">
            ❤ {Math.round((data.player.lifesteal ?? 0) * 1000) / 10}% lifesteal
          </span>
        {/if}
        <span class="chip" style="--accent: var(--color-ink-500)"
          >score {data.player.gearScore}</span
        >
        {#each data.player.setBonuses.filter((set) => set.active.length > 0) as set (set.id)}
          <span class="chip" style="--accent: {ACCENT.violet}">{set.name} {set.pieces}</span>
        {/each}
        <span class="text-xs text-ink-400">auto-eat under {foodThreshold}%</span>
        {#if foodNote}
          <span class="text-xs text-ink-500">· {foodNote}</span>
        {/if}
      </div>
    {/if}
  </div>

  {#if combat.error}
    <p class="banner mb-3" style="--accent: {ACCENT.ember}" role="alert">{combat.error}</p>
  {/if}

  {#if combat.loading}
    <p class="banner flex items-center gap-2" style="--accent: {ACCENT.ember}">
      <Spinner size={14} label="Loading encounter" /> Loading…
    </p>
  {:else if encounter}
    <FightBoard {encounter} {hit} {justHit} {hitSeq} {drank} {itemMap} {busy} onFlee={flee} />

    {#if hit}
      <HitReport {hit} {skillMap} {itemMap} />
    {/if}

    {#if hit && hit.outcome !== 'ongoing'}
      <OutcomePanel {hit} {itemMap} onLeave={leave} />
    {:else if instance}
      {#if !timerStarted}
        <div class="panel p-5 text-center lg:mx-auto lg:max-w-xl">
          <p class="display text-lg text-ink-200">Ready?</p>
          <p class="mt-1 text-xs text-ink-400">
            {COMBAT_TIME_LIMIT_MS / 1000}s per drill. It hits you every exchange — bring food.
          </p>
          <button onclick={startTimer} class="btn btn-primary mt-3 px-5 py-2" data-enter-action>
            Start
          </button>
        </div>
      {:else}
        <div class="mb-2 flex items-center justify-between text-xs">
          <span class="text-ink-400">Time attack</span>
          <span class={timeLeftSec <= 5 ? 'text-ember-300' : 'text-ink-400'}>{timeLeftSec}s</span>
        </div>
        <div class="bar mb-2" style="--accent: {timeLeftSec <= 5 ? ACCENT.ember : ACCENT.jade}">
          <i style="width: {timePct}%"></i>
        </div>
        {#key instance}
          {@const Comp = componentFor(instance.exerciseId)}
          <div class="panel p-5 lg:mx-auto lg:max-w-xl">
            <Comp {instance} {busy} onsubmit={submit} />
          </div>
        {/key}
      {/if}
    {:else}
      <p class="text-sm text-ink-400">No drill available — try again.</p>
    {/if}
  {:else if data}
    <MonsterList {data} {itemMap} onFight={fight} />
  {/if}
</div>

<ConfirmDialog
  open={pendingFlee}
  title="Leave fight"
  message="Leave the fight? Your progress in this battle is lost."
  confirmLabel="Leave fight"
  {busy}
  onConfirm={confirmFlee}
  onCancel={() => (pendingFlee = false)}
/>
