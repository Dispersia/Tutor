<script lang="ts">
  import { href } from '#lib/paths'
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
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
  import type { Grade, Instance } from '#lib/exercises'
  import { getSkills, type SkillsResponse } from '#lib/skills'
  import { accentStyle, tierAccent } from '#lib/theme'
  import { ACCENT } from '#lib/theme'
  import Icon from '#lib/components/Icon.svelte'
  import Spinner from '#lib/components/Spinner.svelte'
  import { peekCached } from '#lib/cache'

  // Seed from the last fetch so returning to Combat shows the board at once.
  const cachedCombat = peekCached<CombatResponse>('/api/combat')
  const cachedSkills = peekCached<SkillsResponse>('/api/skills')
  let data = $state<CombatResponse | null>(cachedCombat ?? null)
  let ref = $state<SkillsResponse | null>(cachedSkills ?? null)
  let encounter = $state<EncounterDTO | null>(cachedCombat?.encounter ?? null)
  let instance = $state<Instance | null>(cachedCombat?.instance ?? null)
  let result = $state<Grade | null>(null)
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
  const name = (id: string) => itemMap.get(id)?.name ?? id
  const icon = (id: string) => itemMap.get(id)?.icon ?? ''
  // The fight trains whatever profession the equipped weapon is for.
  const fightSkill = $derived(skillMap.get(data?.player.skill ?? '')?.name ?? '')
  const fightSkillIcon = $derived(skillMap.get(data?.player.skill ?? '')?.icon ?? '')
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
      const [c, s, set] = await Promise.all([
        getCombat(),
        getSkills().catch(() => null),
        api<{ foodThreshold?: number }>('/api/settings').catch(() => null),
      ])
      data = c
      ref = s
      encounter = c.encounter
      // Resuming a fight: adopt the drill the server rebuilt for this encounter
      // so the fight keeps going after a reload. The clock waits for Start.
      if (c.encounter) {
        instance = c.instance
        stopTimer()
      }
      justHit = false
      if (set?.foodThreshold) foodThreshold = set.foodThreshold
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  }

  async function fight(m: MonsterDTO) {
    error = ''
    stopTimer()
    try {
      const r = await startFight(m.id)
      encounter = r.encounter
      instance = r.instance
      drank = r.drank
      result = null
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
      const r = await combatHit({
        exerciseId: instance.exerciseId,
        cardId: instance.cardId,
        answer,
        timedOut,
      })
      result = r.result
      hit = r.hit
      justHit = r.hit.playerDamage > 0
      if (r.hit.playerDamage > 0) hitSeq += 1
      encounter = r.encounter
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
    } catch (e) {
      error = (e as Error).message
      stopTimer()
    } finally {
      busy = false
    }
  }

  function leave() {
    stopTimer()
    encounter = null
    instance = null
    result = null
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
        <button onclick={flee} disabled={busy} class="btn btn-ghost px-3 py-1.5 text-xs">
          Leave fight
        </button>
      </div>
    </div>

    {#if hit}
      <div class="mb-3 flex flex-wrap gap-2">
        {#if hit.correct}
          <span class="chip gap-1" style="--accent: {ACCENT.jade}"
            ><Icon name="sword" size={12} /> you hit for {hit.damage}</span
          >
          {#if hit.crit}
            <span class="chip" style="--accent: {ACCENT.ember}">Critical!</span>
          {/if}
          {#if hit.haste}
            <span class="chip" style="--accent: {ACCENT.azure}">Haste strike</span>
          {/if}
        {/if}
        {#if hit.playerDamage > 0}
          <span class="chip gap-1" style="--accent: {ACCENT.ember}"
            ><Icon name="burst" size={12} /> it hit you for {hit.playerDamage}</span
          >
        {/if}
        {#if hit.xp > 0}
          <span class="chip" style="--accent: {ACCENT.azure}">
            {skillMap.get(hit.skill)?.icon ?? ''} +{hit.xp}
            {skillMap.get(hit.skill)?.name ?? hit.skill}
          </span>
        {/if}
        {#if hit.defenceXp > 0}
          <span class="chip gap-1" style="--accent: {ACCENT.jade}">
            <Icon name="shield" size={12} /> +{hit.defenceXp} Defence
          </span>
        {/if}
        {#if hit.constitutionXp > 0}
          <span class="chip gap-1" style="--accent: {ACCENT.ember}">
            <Icon name="heart" size={12} /> +{hit.constitutionXp} Constitution
          </span>
        {/if}
        {#if hit.ate}
          <span class="chip gap-1" style="--accent: {ACCENT.brass}">
            <Icon name="food" size={12} /> auto-ate {name(hit.ate.item)} (+{hit.ate.heal})
          </span>
        {/if}
        {#if hit.talentUnlocked}
          <a href={href(`/skills/${hit.skill}`)} class="chip" style="--accent: {ACCENT.gold}">
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
  {:else}
    <!-- monster list -->
    {#if data && data.reviewCount === 0}
      <div class="panel mb-3 p-4 text-sm text-ink-300">
        Combat is review only — practise a few cards first, then come back to fight.
      </div>
    {/if}
    <div class="space-y-2 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0">
      {#each data?.monsters ?? [] as m (m.id)}
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
              onclick={() => fight(m)}
              disabled={!m.unlocked || (data?.reviewCount ?? 0) === 0}
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
  {/if}
</div>
