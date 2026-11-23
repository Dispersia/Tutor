<script lang="ts">
  import { onMount } from 'svelte'
  import { componentFor } from '#lib/components/exercises'
  import { api } from '#lib/api'
  import {
    abandonFight,
    combatHit,
    COMBAT_TIME_LIMIT_MS,
    getCombat,
    startFight,
    type CombatResponse,
    type EncounterDTO,
    type HitResult,
    type MonsterDTO,
  } from '#lib/combat'
  import type { Instance } from '#lib/exercises'
  import { getSkills, type SkillsResponse } from '#lib/skills'
  import { ACCENT } from '#lib/theme'
  import Icon from '#lib/components/Icon.svelte'
  import Spinner from '#lib/components/Spinner.svelte'
  import FightBoard from '#lib/components/combat/FightBoard.svelte'
  import HitReport from '#lib/components/combat/HitReport.svelte'
  import MonsterList from '#lib/components/combat/MonsterList.svelte'
  import OutcomePanel from '#lib/components/combat/OutcomePanel.svelte'
  import { countConsumables } from '#lib/combatview'
  import { peekCached } from '#lib/cache'

  // Seed from the last fetch so returning to Combat shows the board at once.
  const cachedCombat = peekCached<CombatResponse>('/api/combat')
  const cachedSkills = peekCached<SkillsResponse>('/api/skills')
  let data = $state<CombatResponse | null>(cachedCombat ?? null)
  let ref = $state<SkillsResponse | null>(cachedSkills ?? null)
  let encounter = $state<EncounterDTO | null>(cachedCombat?.encounter ?? null)
  let instance = $state<Instance | null>(cachedCombat?.instance ?? null)
  let hit = $state<HitResult | null>(null)
  let drank = $state<{ item: string; buff: { kind: string; value: number } } | null>(null)
  let foodThreshold = $state(50)
  let busy = $state(false)
  let error = $state('')
  let loading = $state(cachedCombat === undefined)
  /**
   * Time attack: each drill has a countdown. The first drill of a fight waits
   * for a Start click; every drill after that starts its own clock. A timeout
   * is a miss, so the monster gets to hit back.
   */
  let timerStarted = $state(false)
  let deadline = $state(0)
  let now = $state(Date.now())
  /** One timeout per drill, so the ticking clock can't submit twice. */
  let timeoutFired = $state(false)
  /** Bumps on every monster hit so the health block remounts and re-shakes. */
  let hitSeq = $state(0)
  /** The last exchange took a monster hit — jolt the health block. */
  let justHit = $state(false)
  const timeLeft = $derived(Math.max(0, deadline - now))
  const timeLeftSec = $derived(Math.ceil(timeLeft / 1000))
  const timePct = $derived(
    deadline > 0 ? Math.max(0, Math.min(100, (timeLeft / COMBAT_TIME_LIMIT_MS) * 100)) : 0,
  )

  const itemMap = $derived(new Map((ref?.items ?? []).map((i) => [i.id, i])))
  const skillMap = $derived(new Map((ref?.skills ?? []).map((s) => [s.id, s])))
  // The fight trains whatever profession the equipped weapon is for.
  const fightSkill = $derived(skillMap.get(data?.player.skill ?? '')?.name ?? '')
  const fightSkillIcon = $derived(skillMap.get(data?.player.skill ?? '')?.icon ?? '')
  const consumables = $derived(countConsumables(ref?.inventory ?? [], itemMap))
  const foodCount = $derived(consumables.food)
  const potionCount = $derived(consumables.potions)

  onMount(refresh)

  /** Tick the clock while a drill is live. */
  $effect(() => {
    if (!timerStarted) return
    const timer = setInterval(() => (now = Date.now()), 100)
    return () => clearInterval(timer)
  })

  /** When the clock runs out, take the miss once. */
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
    try {
      const [c, s, set] = await Promise.all([getCombat(), getSkills().catch(() => null), prefs()])
      applyCombat(c, s, set?.foodThreshold)
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  }

  const prefs = () => api<{ foodThreshold?: number }>('/api/settings').catch(() => null)

  /** Applies a fresh combat + skills board, adopting any running encounter. */
  function applyCombat(c: CombatResponse, s: SkillsResponse | null, food?: number) {
    data = c
    ref = s
    // A finished fight stays up until the player leaves the outcome panel.
    if (!hit || hit.outcome === 'ongoing') encounter = c.encounter
    // Resuming a fight: adopt the drill the server rebuilt for this encounter
    // so the fight keeps going after a reload. The clock waits for Start.
    if (c.encounter) {
      instance = c.instance
      stopTimer()
    }
    justHit = false
    if (food) foodThreshold = food
  }

  async function fight(m: MonsterDTO) {
    error = ''
    stopTimer()
    try {
      const r = await startFight(m.id)
      encounter = r.encounter
      instance = r.instance
      drank = r.drank
      hit = null
      justHit = false
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function submit(answer: unknown, timedOut = false) {
    if (!instance || busy) return
    busy = true
    error = ''
    try {
      applyHit(await combatHit(hitBody(answer, timedOut)))
    } catch (e) {
      error = (e as Error).message
      stopTimer()
    } finally {
      busy = false
    }
  }

  /** The server body for one exchange. */
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

  /** Applies one exchange: the hit, the next drill and the drill clock. */
  function applyHit(r: Awaited<ReturnType<typeof combatHit>>) {
    hit = r.hit
    justHit = r.hit.playerDamage > 0
    if (r.hit.playerDamage > 0) hitSeq += 1
    // The server clears a finished encounter; keep the last one on screen (at its
    // final HP) so the outcome panel and the loot have a fight to render under.
    encounter = r.encounter ?? finalState(encounter, r.hit)
    instance = r.instance
    if (r.hit.outcome !== 'ongoing') {
      // fight over — refresh the monster list / bank
      stopTimer()
      void refresh()
    } else if (r.instance) {
      // time attack: the next drill starts its own clock straight away
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

  /** Flee: drop the encounter on the server, then return to the monster list. */
  async function flee() {
    if (busy) return
    if (!confirm('Leave the fight? Your progress in this battle is lost.')) return
    busy = true
    error = ''
    try {
      await abandonFight()
      leave()
    } catch (e) {
      error = (e as Error).message
    } finally {
      busy = false
    }
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

<div class="lg:mx-auto lg:max-w-3xl">
  <div class="border-b border-ink-700 pt-4 pb-4 mb-4">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h1 class="display text-3xl text-combat-400">Combat</h1>
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
            aria-label="Your hit points"
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
      </div>
    {/if}
  </div>

  {#if error}
    <p class="banner mb-3" style="--accent: {ACCENT.ember}" role="alert">{error}</p>
  {/if}

  {#if loading}
    <p class="banner flex items-center gap-2" style="--accent: {ACCENT.ember}">
      <Spinner size={14} label="Loading encounter" /> Loading…
    </p>
  {:else if encounter}
    <!-- active fight -->
    <FightBoard {encounter} {hit} {justHit} {hitSeq} {drank} {itemMap} {busy} onFlee={flee} />

    {#if hit}
      <HitReport {hit} {skillMap} {itemMap} />
    {/if}

    {#if hit && hit.outcome !== 'ongoing'}
      <OutcomePanel {hit} {itemMap} onLeave={leave} />
    {:else if instance}
      {#if !timerStarted}
        <!-- The first drill of a fight waits for Start; after that each drill's
           clock starts on its own. -->
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
        <!-- Key on the instance so a fresh drill remounts the component. Otherwise
           two same-type drills in a row reuse it and keep the last answer text. -->
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
    <MonsterList {data} {skillMap} {itemMap} onFight={fight} />
  {/if}
</div>
