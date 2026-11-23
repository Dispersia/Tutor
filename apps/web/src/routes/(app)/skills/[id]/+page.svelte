<script lang="ts">
  import { href } from '#lib/paths'
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import { onMount, tick } from 'svelte'
  import {
    chooseAction,
    chooseTalent,
    distillGear,
    getSkill,
    stopRig,
    type ActionDTO,
    type BandDTO,
    type OwnedTalent,
    type SkillPageResponse,
    type TalentOption,
  } from '#lib/skills'
  import { fmtClock, fmtInterval, rigSecondsLeft } from '#lib/idle'
  import type { ModKind } from '#lib/types'
  import { CATEGORY, ACCENT, accentStyle, categoryAccent } from '#lib/theme'
  import Icon from '#lib/components/Icon.svelte'
  import { peekCached } from '#lib/cache'

  // Seed from the last fetch so returning to a profession renders at once.
  const initialId = page.params.id
  const cachedSkill = peekCached<SkillPageResponse>(`/api/skills/${initialId}`)
  let data = $state<SkillPageResponse | null>(cachedSkill ?? null)
  let error = $state('')
  let note = $state('')
  let loading = $state(cachedSkill === undefined)
  let busy = $state(false)
  let changing = $state<string | null>(null)
  /** The action row a material link jumped to, briefly tinted so you can find it. */
  let flash = $state<string | null>(null)
  /** Ticking clock so a rig's run bar and clock drain live (§13.5.1). */
  let now = $state(Date.now())

  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 250)
    return () => clearInterval(timer)
  })

  const id = $derived(page.params.id)
  const pct = (v: number) => `${Math.round(v * 100)}%`
  // Short labels for each passive kind, so a value like "now 18%" can't be read
  // as level progress. The kind names the stat the bonus actually boosts.
  const EFFECT_LABEL: Record<ModKind, string> = {
    yield: 'yield',
    double: 'bonus product',
    xp: 'XP',
    coins: 'coins',
    global_xp: 'global XP',
    damage: 'power',
    drop: 'rare drops',
    hp: 'HP',
  }
  const skill = $derived(data?.skill ?? null)
  const accent = $derived(skill ? categoryAccent(skill.category) : ACCENT.azure)
  /** The live-rig cap readout (§13.5.1): how many machines may run, and how many are. */
  const rigs = $derived(data?.rigs ?? { maxLive: 2, live: 0 })
  const catLabel = $derived(skill ? CATEGORY[skill.category].label : '')
  const itemMap = $derived(new Map((data?.items ?? []).map((i) => [i.id, i])))
  /** How many of each material the player holds — a cost chip can say what you have. */
  const ownedMap = $derived(new Map((data?.inventory ?? []).map((i) => [i.itemId, i.count])))
  /** Where each material is made, so a "needs" cost can link to its source action. */
  const sources = $derived(data?.sources ?? {})
  /** The first action you can actually train — the one indigo primary on the view. */
  const firstTrainableId = $derived(skill?.actions.find((a) => a.unlocked && a.affordable)?.id)

  /** Distill panel state (Enchanting only, §13.5.3.2). */
  let distillNote = $state('')
  /** Inventory items you can burn to train Enchanting, richest first. */
  const distillables = $derived.by(() => {
    if (skill?.id !== 'enchanting') return []
    return (data?.inventory ?? [])
      .filter((r) => r.count > 0 && r.itemId !== 'coins')
      .map((r) => ({
        itemId: r.itemId,
        count: r.count,
        name: itemMap.get(r.itemId)?.name ?? r.itemId,
        icon: itemMap.get(r.itemId)?.icon ?? '◆',
        value: itemMap.get(r.itemId)?.value ?? 0,
      }))
      .sort((a, b) => b.value - a.value)
  })

  async function doDistill(itemId: string) {
    busy = true
    distillNote = ''
    try {
      const res = await distillGear(itemId)
      distillNote = `+${res.xp} Enchanting XP · +1 ${res.essence.replace('_', ' ')}`
      if (id) await load(id)
    } catch (e) {
      error = (e as Error).message
    } finally {
      busy = false
    }
  }

  /**
   * Actions grouped under their material band (§13.5.3). Only artisans with bands
   * (Smithing) get the grouped view; anything else renders the flat list.
   */
  const bandGroups = $derived.by(() => {
    const s = skill
    const bands = s?.bands ?? []
    if (!s || !bands.length) return null
    const byBand = new Map<string, ActionDTO[]>()
    const other: ActionDTO[] = []
    for (const a of s.actions) {
      if (a.band) {
        const list = byBand.get(a.band.id) ?? []
        list.push(a)
        byBand.set(a.band.id, list)
      } else {
        other.push(a)
      }
    }
    return {
      groups: bands.map((band) => ({ band, actions: byBand.get(band.id) ?? [] })),
      other,
    }
  })

  /**
   * The whole talent ladder in one rail: a choice every 10 levels, with a mastery
   * capstone sitting alongside the Lv 50 and Lv 100 rows. Showing the locked
   * milestones too is the point — it makes the ladder (and what is still coming)
   * visible instead of only the one choice that happens to be open.
   */
  type Row = {
    milestone: number
    kind: 'choice' | 'mastery'
    state: 'done' | 'open' | 'locked'
    owned?: OwnedTalent
    options: TalentOption[]
  }

  const rail = $derived.by<Row[]>(() => {
    const s = data?.skill
    if (!s) return []
    const rows: Row[] = []
    for (let m = 10; m <= 100; m += 10) {
      const chosen = s.talent.owned.find((t) => t.milestone === m)
      const open = s.talent.pendingChoice && s.talent.milestone === m
      rows.push({
        milestone: m,
        kind: 'choice',
        state: chosen ? 'done' : open ? 'open' : 'locked',
        owned: chosen,
        options: open ? s.talent.options : [],
      })
      if (!s.talent.mastery.milestones.includes(m)) continue
      const capstone = s.talent.mastery.owned.find((t) => t.milestone === m)
      const capstoneOpen = s.talent.mastery.pending.find((p) => p.milestone === m)
      rows.push({
        milestone: m,
        kind: 'mastery',
        state: capstone ? 'done' : capstoneOpen ? 'open' : 'locked',
        owned: capstone,
        options: capstoneOpen?.options ?? [],
      })
    }
    return rows
  })

  $effect(() => {
    const current = id
    if (!current) return
    void load(current)
  })

  /**
   * A material link lands on `/skills/<profession>#action-<id>`: once that
   * profession has loaded, scroll the source action into view and tint it, so
   * clicking "copper ore" drops you right on "Mine copper".
   */
  $effect(() => {
    const hash = page.url.hash
    if (!hash || !data) return
    void highlight(decodeURIComponent(hash.replace(/^#/, '')))
  })

  async function highlight(target: string) {
    await tick()
    const el = document.getElementById(target)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    flash = target
    setTimeout(() => {
      if (flash === target) flash = null
    }, 1800)
  }

  async function load(skillId: string) {
    // A cached profession for this id renders at once; only a cold id waits.
    const cached = peekCached<SkillPageResponse>(`/api/skills/${skillId}`)
    if (cached) {
      data = cached
      loading = false
    } else {
      loading = true
    }
    error = ''
    try {
      data = await getSkill(skillId)
    } catch (e) {
      error = (e as Error).message
      if (!cached) data = null
    } finally {
      loading = false
    }
  }

  async function pick(talentId: string) {
    note = ''
    busy = true
    try {
      await chooseTalent(talentId)
      note = 'Talent saved.'
      changing = null
      if (id) await load(id)
    } catch (e) {
      error = (e as Error).message
    } finally {
      busy = false
    }
  }

  function train(a: ActionDTO) {
    const choice = a.choices?.length ? `&choice=${encodeURIComponent(a.choice)}` : ''
    void goto(href(`/practice?action=${a.id}${choice}`))
  }

  /** Pick which recipe a choose-input action runs (prospect ore, cut a gem). */
  async function pickChoice(a: ActionDTO, choiceId: string) {
    busy = true
    error = ''
    try {
      await chooseAction(a.id, choiceId)
      if (id) await load(id)
    } catch (e) {
      error = (e as Error).message
    } finally {
      busy = false
    }
  }

  /**
   * Stop a running rig on purpose (§13.5.1). Confirmed first: the run ends now and
   * its slot frees, so it is how you make room for a machine you would rather run.
   */
  async function cancelRig(a: ActionDTO) {
    if (!confirm(`Stop the ${a.name} rig? Its run ends now and frees a slot for another action.`))
      return
    busy = true
    error = ''
    try {
      await stopRig(a.id)
      if (id) await load(id)
    } catch (e) {
      error = (e as Error).message
    } finally {
      busy = false
    }
  }

  /** The band gate blocking an action, if any (e.g. `Bronze 40`). */
  function bandGate(a: ActionDTO): string {
    const missing = a.missingBands ?? []
    if (missing.length) return missing.map((b) => `${b.name} ${b.level}`).join(', ')
    if (a.band && a.band.current < a.band.level) return `${a.band.name} ${a.band.level}`
    return ''
  }

  /** The band's current total contribution, e.g. `+4.2% crit` or `+5 stamina`. */
  function bandBuff(b: BandDTO): string {
    const v = b.buffValue ?? 0
    if (!v) return ''
    return b.buffStat === 'stamina'
      ? `+${Math.round(v)} stamina`
      : `+${Math.round(v * 1000) / 10}% ${b.buffStat}`
  }

  function lockedReason(a: ActionDTO): string {
    const band = bandGate(a)
    if (band) return band
    if (a.missingUnlocks.length) {
      return a.missingUnlocks.map((u) => `${u.skill} ${u.level}`).join(', ')
    }
    if (a.equipMissing) return `equip a ${a.equipMissing.tag} ${a.equipMissing.slot}`
    if (a.missing.length)
      return `${a.missing.map((m) => `${m.count}× ${itemMap.get(m.item)?.name ?? m.item}`).join(', ')}`
    return ''
  }

  // A capstone option carries a cross-profession gate; choice options never do,
  // so `blocked` is false for them and the button always reads "Choose".
  const blocked = (o: TalentOption) => (o.requires ?? []).some((r) => !r.met)

  /**
   * The gate that blocks an action, without restating missing materials that
   * the cost chips already show. A level or equip gate is the only thing the
   * chips cannot explain.
   */
  function actionGate(a: ActionDTO): string {
    const band = bandGate(a)
    if (band) return band
    if (a.missingUnlocks.length)
      return a.missingUnlocks.map((u) => `${u.skill} ${u.level}`).join(', ')
    if (a.equipMissing) return `equip a ${a.equipMissing.tag} ${a.equipMissing.slot}`
    return ''
  }
  const unmet = (o: TalentOption) =>
    (o.requires ?? [])
      .filter((r) => !r.met)
      .map((r) => `needs ${r.skill} ${r.level}`)
      .join(', ')
</script>

<div class="pt-4">
  <button onclick={() => goto(href('/skills'))} class="link link-btn text-sm">← Skills</button>
</div>

{#if error}
  <p class="banner mt-3" style={accentStyle(ACCENT.ember)} role="alert">{error}</p>
{/if}
{#if note}
  <p class="banner mt-3" style={accentStyle(ACCENT.jade)}>{note}</p>
{/if}

{#if loading}
  <p class="mt-4 text-sm text-ink-400">Loading…</p>
{:else if skill}
  <!-- Header ---------------------------------------------------------------->
  <header class="mt-3 border-b border-ink-700 pb-4 mb-4" style={accentStyle(accent)}>
    <div class="flex items-start justify-between gap-4">
      <h1 class="display min-w-0 truncate text-3xl text-ink-100">{skill.name}</h1>
      <div class="shrink-0 text-center">
        <div
          class="tile grid h-14 w-14 place-items-center"
          aria-label="Level {skill.level} of 100, the average of {skill.actions.length} actions"
        >
          <span class="display text-xl leading-none font-bold" style="color: {accent}"
            >{skill.level}</span
          >
        </div>
        <p class="seal__label" aria-hidden="true">Level</p>
      </div>
    </div>
    <p class="sub mt-2">{catLabel} · {skill.description}</p>
  </header>

  {#if skill.id === 'enchanting'}
    <!-- Distill (§13.5.3.2): burn an item from your inventory to train Enchanting
         and pull out its essence. -->
    <section class="panel mt-4 p-3" style={accentStyle(accent)}>
      <div class="flex items-center justify-between gap-2">
        <h2 class="eyebrow" style="color: var(--accent)">Distill</h2>
        <span class="text-[11px] text-ink-400">+XP by coin value · yields essence</span>
      </div>
      {#if distillables.length === 0}
        <p class="mt-2 text-xs text-ink-400">Nothing to distill — gather or craft something first.</p>
      {:else}
        <ul class="mt-2 flex max-h-96 flex-col gap-1 overflow-auto">
          {#each distillables as d (d.itemId)}
            <li class="flex items-center justify-between gap-2 border-b border-ink-700 pb-1">
              <span class="min-w-0 truncate text-xs text-ink-200">
                {d.icon}
                {d.name}
                <span class="text-ink-500">×{d.count} · {d.value} coins</span>
              </span>
              <button
                type="button"
                class="btn btn-ghost shrink-0 px-2 py-0.5 text-[10px]"
                disabled={busy}
                onclick={() => doDistill(d.itemId)}
              >
                Distill
              </button>
            </li>
          {/each}
        </ul>
        {#if distillNote}
          <p class="mt-2 text-xs" style="color: var(--color-jade)">{distillNote}</p>
        {/if}
      {/if}
    </section>
  {/if}

  <!-- Mobile order is ledger → actions → talents: the thing you actually do comes
       before the long-term ladder. At xl the two columns return, with the ledger
       and its talents in the left column and actions on the right. -->
  <div
    class="flex flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] xl:items-start xl:gap-x-24"
  >
    <div class="order-1 xl:order-none xl:col-start-1 xl:row-start-1">
      <!-- Ledger ---------------------------------------------------------------->
      <section style={accentStyle(accent)}>
        <div class="border-b border-ink-700 py-3">
          <div class="flex items-baseline justify-between gap-2 text-sm">
            <span class="text-ink-300"
              >Level {skill.level}/100 · average of {skill.actions.length} action{skill.actions
                .length === 1
                ? ''
                : 's'}</span
            >
            <span class="text-ink-400 tabular-nums">{pct(skill.progress)} avg</span>
          </div>
          <div class="bar mt-2"><i style="width: {skill.progress * 100}%"></i></div>
        </div>
        <div class="flex items-baseline justify-between gap-2 border-b border-ink-700 py-3 text-sm">
          <span class="min-w-0 text-ink-300">{skill.effectLabel}</span>
          <span class="display shrink-0 text-lg font-bold" style="color: {accent}"
            >{pct(skill.effect.value)}/lv</span
          >
        </div>
        <div class="flex items-baseline justify-between gap-2 border-b border-ink-700 py-3 text-sm">
          <span class="text-ink-300">XP total</span>
          <span class="display text-lg font-bold text-gold-200 tabular-nums">{skill.xp}</span>
        </div>
        <div class="flex items-baseline justify-between gap-2 border-b border-ink-700 py-3 text-sm">
          <span class="text-ink-300">Rigs running</span>
          <span class="display shrink-0 tabular-nums" style="color: {accent}"
            >{rigs.live}/{rigs.maxLive}</span
          >
        </div>
        {#if skill.category === 'combat'}
          <a
            href={href('/combat')}
            class="flex items-center gap-2 border-b border-ink-700 py-3 text-sm"
            style={accentStyle(accent)}
          >
            <Icon name="skull" size={17} />
            <span class="flex-1 text-ink-100">Go to combat</span>
            <span class="text-ink-400">→</span>
          </a>
        {/if}
      </section>

      <!-- Cross-training links, shown only once the talent is actually taken: the
           talent rail is where a talent describes itself. ----------------------->
      {#if skill.talent.synergy.taken.length}
        <a
          href={href(`/skills/${skill.talent.synergy.target}`)}
          class="flex items-center gap-2.5 border-b border-ink-700 py-3 text-sm"
          style={accentStyle(ACCENT.violet)}
        >
          <Icon name="link" size={16} cls="text-violet-300" />
          <span class="min-w-0 flex-1 text-ink-300">
            Feeds <span class="text-ink-100">{skill.talent.synergy.name}</span>
            <span class="text-ink-400">· {skill.talent.synergy.label}</span>
          </span>
          <span class="text-ink-400">→</span>
        </a>
      {/if}

      {#each (data?.fedBy ?? []).filter((f) => f.taken.length) as f (f.skillId)}
        <a
          href={href(`/skills/${f.skillId}`)}
          class="flex items-center gap-2.5 border-b border-ink-700 py-3 text-sm"
          style={accentStyle(ACCENT.violet)}
        >
          <Icon name="link" size={16} cls="text-violet-300" />
          <span class="min-w-0 flex-1 text-ink-300">
            Fed by <span class="text-ink-100">{f.name}</span>
            <span class="text-ink-400">· {f.label}</span>
          </span>
          <span class="text-ink-400">←</span>
        </a>
      {/each}
    </div>

    <div class="order-3 xl:order-none xl:col-start-1 xl:row-start-2">
      <!-- Talents: one rail from Lv 10 to Lv 100 --------------------------------->
      <h2 class="mt-6 eyebrow" style="color: {ACCENT.violet}">Talents</h2>
      <p class="mt-2 border-b border-ink-700 pb-3 text-xs text-ink-400">
        A choice every 10 levels. At <span class="text-violet-300">Lv 50</span> and
        <span class="text-violet-300">Lv 100</span> a capstone also opens — each gated on a level in
        {skill.talent.synergy.name}.
      </p>

      <ul style={accentStyle(ACCENT.violet)}>
        {#each rail as r (`${r.kind}:${r.milestone}`)}
          <li class="flex items-start gap-3 border-b border-ink-700 py-3">
            <div
              class="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border tabular-nums {r.state ===
              'locked'
                ? 'border-ink-700 text-ink-400'
                : 'border-violet-400/60 text-violet-300'}"
            >
              {#if r.kind === 'mastery'}
                <Icon name="trophy" size={17} />
              {:else}
                <span class="display text-sm font-bold">{r.milestone}</span>
              {/if}
            </div>

            <div class="min-w-0 flex-1">
              {#if r.kind === 'mastery'}
                <p class="eyebrow mb-1 text-violet-300">Capstone · Lv {r.milestone}</p>
              {/if}

              {#if r.state === 'done' && r.owned}
                {@const t = r.owned}
                <div class="flex items-baseline justify-between gap-2">
                  <span class="display text-sm text-ink-100">{t.name}</span>
                  {#if r.kind === 'choice'}
                    <span class="text-xs text-ink-400 tabular-nums">Lv {t.milestone}</span>
                  {/if}
                </div>
                <p class="mt-0.5 text-xs text-ink-400">{t.description}</p>
                <button
                  onclick={() => (changing = changing === t.id ? null : t.id)}
                  class="mt-1 text-xs text-ink-400 underline hover:text-ink-200"
                >
                  {changing === t.id ? 'Cancel' : 'Change'}
                </button>
                {#if changing === t.id}
                  <div class="mt-2">
                    {#each t.options.filter((o) => o.id !== t.id) as o (o.id)}
                      <button
                        onclick={() => pick(o.id)}
                        disabled={busy || blocked(o)}
                        class="flex w-full items-center gap-3 border-t border-ink-700 py-2.5 text-left"
                      >
                        <span class="min-w-0 flex-1">
                          <span class="display block text-sm text-ink-200">{o.name}</span>
                          <span class="block text-xs text-ink-400">{o.description}</span>
                        </span>
                        <span
                          class="shrink-0 text-xs {blocked(o) ? 'text-ember-300' : 'text-ink-400'}"
                        >
                          {blocked(o) ? unmet(o) : 'Pick'}
                        </span>
                      </button>
                    {/each}
                  </div>
                {/if}
              {:else if r.state === 'open'}
                {#each r.options as o (o.id)}
                  <button
                    onclick={() => pick(o.id)}
                    disabled={busy || blocked(o)}
                    class="flex w-full items-center gap-3 py-2 text-left first:pt-0"
                  >
                    <span class="h-2 w-2 shrink-0 rounded-[2px] bg-violet-400"></span>
                    <span class="min-w-0 flex-1">
                      <span class="display block text-sm text-ink-100">{o.name}</span>
                      <span class="mt-0.5 block text-xs text-ink-400">{o.description}</span>
                    </span>
                    <span
                      class="shrink-0 text-xs {blocked(o) ? 'text-ember-300' : 'text-violet-300'}"
                    >
                      {blocked(o) ? unmet(o) : 'Choose'}
                    </span>
                  </button>
                {/each}
              {:else}
                <p class="flex items-center gap-1.5 text-xs text-ink-400">
                  <Icon name="lock" size={13} />
                  Reach Lv {r.milestone}
                </p>
              {/if}
            </div>
          </li>
        {/each}
      </ul>

      {#if !skill.talent.pendingChoice}
        <p class="mt-2 pb-1 text-xs text-ink-400">
          {#if skill.talent.nextMilestone}
            Next talent choice at <span class="gold">Lv {skill.talent.nextMilestone}</span>.
          {:else}
            Every level-10 talent is taken.
          {/if}
        </p>
      {/if}
    </div>
    <div class="order-2 xl:order-none xl:col-start-2 xl:row-start-1 xl:row-span-2">
      <!-- Actions --------------------------------------------------------------->
      <h2 class="mt-6 eyebrow xl:mt-0" style="color: {accent}">Actions</h2>
      <p class="mt-1 border-b border-ink-700 pb-2 text-xs text-ink-400">
        {skill.actions.length} action{skill.actions.length === 1 ? '' : 's'} · {skill.actions.filter(
          (a) => a.unlocked,
        ).length} unlocked
      </p>
      {#snippet actionRow(a: ActionDTO)}
          {@const trainable = a.unlocked && a.affordable}
          {@const isPrimary = trainable && a.id === firstTrainableId}
          {@const made = a.produces?.[0]}
          {@const gate = actionGate(a)}
          {@const showGate = !!gate && !a.description.toLowerCase().includes(gate.toLowerCase())}
          <li
            id="action-{a.id}"
            class="panel px-2 py-1.5 transition-colors sm:px-2.5 sm:py-2"
            class:panel-accent={isPrimary}
            class:bg-ink-900={!a.unlocked}
            class:border-seal-400={flash === a.id}
            style={accentStyle(accent)}
          >
            <div class="flex items-start gap-2.5">
              <!-- The item you make is the row's anchor: it reads faster than a
                   repeated tier label. Actions without an output fall back to
                   the tier. -->
              <div
                class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-ink-700 bg-ink-900 text-base"
                aria-hidden="true"
              >
                {#if made}
                  {itemMap.get(made.item)?.icon ?? '◆'}
                {:else}
                  <span class="display text-sm font-bold text-ink-300">{a.tier}</span>
                {/if}
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span
                    class="display text-base font-semibold {a.unlocked
                      ? 'text-ink-100'
                      : 'text-ink-300'}">{a.name}</span
                  >
                  {#if showGate}
                    <span class="text-[11px] text-brass-300">needs {gate}</span>
                  {/if}
                  <span class="display ml-auto shrink-0 text-sm font-bold" style="color: {accent}"
                    >Lv {a.level}</span
                  >
                </div>
                <div class="bar mt-1 h-1.5"><i style="width: {a.progress * 100}%"></i></div>
                <div
                  class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-400 sm:text-xs"
                >
                  <span>Tier {a.tier}</span>
                  <span class="tabular-nums">+{a.xp} xp a drill</span>
                  {#if (a.success ?? 1) < 1}
                    <span style="color: {ACCENT.ember}"
                      >{Math.round((a.success ?? 1) * 100)}% odds</span
                    >
                  {/if}
                  {#if a.level >= 100}
                    <span>Max level</span>
                  {:else}
                    <span class="tabular-nums"
                      >{a.intoLevel}/{a.forNext} XP to Lv {a.level + 1}</span
                    >
                  {/if}
                  {#if a.effect.value > 0}
                    <span style="color: {accent}"
                      >+{pct(a.effect.value)} {EFFECT_LABEL[a.effect.kind]}</span
                    >
                  {/if}
                  {#if a.description}
                    <span class="text-ink-500">· {a.description}</span>
                  {/if}
                  {#if (a.consumes ?? []).length || (a.produces ?? []).length}
                    <span class="flex flex-wrap items-center gap-1">
                      {#each a.consumes ?? [] as c (c.item)}
                        {@const src = sources[c.item]}
                        {@const have = ownedMap.get(c.item) ?? 0}
                        {@const short = have < c.count}
                        {@const label = itemMap.get(c.item)?.name ?? c.item}
                        {#if src}
                          <a
                            href={href(`/skills/${src.skillId}#action-${src.actionId}`)}
                            class="chip chip--tight"
                            style={accentStyle(short ? ACCENT.ember : ACCENT.ink)}
                            title="You have {have} {label} · tap to see where it comes from"
                          >
                            −{c.count}
                            {itemMap.get(c.item)?.icon ?? ''}
                            {label}
                            <span class="chip__have"
                              ><span class="hidden sm:inline">have </span>{have}</span
                            >
                          </a>
                        {:else}
                          <span
                            class="chip chip--tight"
                            style={accentStyle(short ? ACCENT.ember : ACCENT.ink)}
                            title="You have {have} {label}"
                          >
                            −{c.count}
                            {itemMap.get(c.item)?.icon ?? ''}
                            {label}
                            <span class="chip__have"
                              ><span class="hidden sm:inline">have </span>{have}</span
                            >
                          </span>
                        {/if}
                      {/each}
                      {#each a.produces ?? [] as p (p.item)}
                        <span class="chip chip--tight" style={accentStyle(ACCENT.jade)}>
                          +{p.count}
                          {itemMap.get(p.item)?.icon ?? ''}
                          {itemMap.get(p.item)?.name ?? p.item}
                        </span>
                      {/each}
                    </span>
                  {/if}
                  {#if (a.table ?? []).length}
                    <span class="flex flex-wrap items-center gap-1">
                      <span class="text-ink-500">finds one of:</span>
                      {#each a.table ?? [] as e (e.item)}
                        <span class="chip chip--tight" style={accentStyle(ACCENT.violet)}>
                          {itemMap.get(e.item)?.icon ?? '💎'}
                          {itemMap.get(e.item)?.name ?? e.item}
                        </span>
                      {/each}
                    </span>
                  {/if}
                  {#if (a.choices ?? []).length}
                    <span class="flex items-center gap-1">
                      <span class="text-ink-500">using</span>
                      <select
                        class="field px-1 py-0.5 text-[10px]"
                        value={a.choice}
                        disabled={busy}
                        onchange={(e) =>
                          pickChoice(a, (e.currentTarget as HTMLSelectElement).value)}
                        aria-label="Choose the input"
                      >
                        {#each a.choices ?? [] as ch (ch.id)}
                          <option value={ch.id}>{ch.label}</option>
                        {/each}
                      </select>
                    </span>
                  {/if}
                </div>
                {#if a.idle}
                  {@const idleLeft = rigSecondsLeft(a.idle, now)}
                  {@const runPct = Math.min(1, Math.max(0, idleLeft / a.idle.runSec))}
                  <!-- The rig row: the run's rate and clock, over a bar that is the
                       run draining — not a level. Still when the run is over. -->
                  <div
                    class="mt-1"
                    style={accentStyle(accent)}
                    aria-label={a.idle.active
                      ? `Rig running: ${fmtInterval(a.idle.intervalSec)} per item, ${fmtClock(idleLeft)} left`
                      : 'Rig still'}
                  >
                    <div
                      class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-400"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.6"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        width="11"
                        height="11"
                        class="inline-block shrink-0"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="3" />
                        <path
                          d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
                        />
                      </svg>
                      <span class="display tabular-nums" style="color: {accent}"
                        >{fmtInterval(a.idle.intervalSec)}</span
                      >
                      <span class="display text-gold-200 tabular-nums"
                        >+{a.idle.xpPerCraft} xp / item</span
                      >
                      {#if a.idle.active}
                        <span class="display tabular-nums" style="color: {accent}"
                          >{fmtClock(idleLeft)} left</span
                        >
                      {:else}
                        <span class="text-ink-400">still</span>
                      {/if}
                      {#if a.idle.maxed}
                        <span class="display" style="color: {ACCENT.jade}" title="Run is at the cap"
                          >maxed</span
                        >
                      {:else}
                        <span class="tabular-nums"
                          >{a.idle.completions}/{a.idle.runFullAtCompletions} to
                          {fmtClock(a.idle.maxRunSec)}</span
                        >
                      {/if}
                      {#if a.idle.active}
                        <button
                          type="button"
                          class="btn btn-ghost min-h-5 px-1.5 py-0 text-[11px] text-ink-400 hover:text-ember-300"
                          disabled={busy}
                          onclick={() => cancelRig(a)}
                          title="Stop this rig now and free its slot"
                        >
                          Stop
                        </button>
                      {/if}
                    </div>
                    <div class="bar mt-1 h-1" role="progressbar" aria-label="Rig run remaining">
                      {#if a.idle.active}
                        <i style="width: {runPct * 100}%; background: {accent}"></i>
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
              <button
                onclick={() => train(a)}
                disabled={!trainable}
                title={!trainable ? lockedReason(a) : undefined}
                class="btn {isPrimary
                  ? 'btn-primary'
                  : 'btn-ghost'} min-h-8 shrink-0 px-2.5 py-1 text-xs"
              >
                Train
              </button>
            </div>
          </li>
      {/snippet}

      {#if bandGroups}
        <!-- A metal is a band (§13.5.3): one shared score, a dropdown of the whole
             set, and the next metal opening at Lv 40. -->
        <div class="mt-3 flex flex-col gap-3">
          {#each bandGroups.groups as g (g.band.id)}
            {@const b = g.band}
            {@const open = b.gearUnlocked < b.gearTotal || g.actions.some((a) => a.unlocked)}
            <details class="panel px-2.5 py-2" open={open}>
              <summary
                class="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 select-none"
              >
                <span class="text-base" aria-hidden="true">{b.icon}</span>
                <span class="display text-sm font-semibold text-ink-100">{b.name}</span>
                <span class="display text-sm font-bold tabular-nums" style="color: {accent}"
                  >Lv {b.level}</span
                >
                <span class="text-[11px] text-ink-400"
                  >{b.gearUnlocked}/{b.gearTotal} gear</span
                >
                <span class="ml-auto text-[11px]" style="color: {ACCENT.jade}"
                  >{bandBuff(b) ? `now ${bandBuff(b)}` : b.buffLabel}</span
                >
              </summary>
              <div class="bar mt-1.5 h-1.5"><i style="width: {b.progress * 100}%"></i></div>
              <p class="mt-1 text-[11px] text-ink-400">
                {#if b.nextUnlock}
                  Next: {b.nextUnlock.name} at {b.name} {b.nextUnlock.level}.
                {/if}
                {#if b.level < b.gearUnlockLevel}
                  All {b.name} gear by Lv {b.gearUnlockLevel}; the next metal opens then.
                {:else}
                  Gear unlocked · keeps giving {b.buffLabel} and {b.enchantLabel} reagents to Lv 100.
                {/if}
              </p>
              <ul class="mt-2 flex flex-col gap-1.5">
                {#each g.actions as a (a.id)}{@render actionRow(a)}{/each}
              </ul>
            </details>
          {/each}
          {#if bandGroups.other.length}
            <ul class="flex flex-col gap-1.5">
              {#each bandGroups.other as a (a.id)}{@render actionRow(a)}{/each}
            </ul>
          {/if}
        </div>
      {:else}
        <ul class="mt-2 flex flex-col gap-1.5">
          {#each skill.actions as a (a.id)}{@render actionRow(a)}{/each}
        </ul>
      {/if}
      <div class="h-4"></div>
    </div>
  </div>
{:else}
  <p class="mt-4 text-sm text-ink-400">Profession not found.</p>
{/if}
