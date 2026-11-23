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
    type SkillPageResponse,
  } from '#lib/skills'
  import { CATEGORY, ACCENT, accentStyle, categoryAccent } from '#lib/theme'
  import Icon from '#lib/components/Icon.svelte'
  import ActionRow from '#lib/components/skill/ActionRow.svelte'
  import { peekCached } from '#lib/cache'
  import { bandBuff, buildBandGroups, buildTalentRail, isBlocked, unmetOf } from '#lib/skillview'

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

  /** Actions grouped under their material band (§13.5.3), or null for a flat list. */
  const bandGroups = $derived(skill ? buildBandGroups(skill) : null)

  /** The whole talent ladder, one row per milestone (see `skillview`). */
  const rail = $derived(skill ? buildTalentRail(skill) : [])

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
        <p class="mt-2 text-xs text-ink-400">
          Nothing to distill — gather or craft something first.
        </p>
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
                        disabled={busy || isBlocked(o)}
                        class="flex w-full items-center gap-3 border-t border-ink-700 py-2.5 text-left"
                      >
                        <span class="min-w-0 flex-1">
                          <span class="display block text-sm text-ink-200">{o.name}</span>
                          <span class="block text-xs text-ink-400">{o.description}</span>
                        </span>
                        <span
                          class="shrink-0 text-xs {isBlocked(o)
                            ? 'text-ember-300'
                            : 'text-ink-400'}"
                        >
                          {isBlocked(o) ? unmetOf(o) : 'Pick'}
                        </span>
                      </button>
                    {/each}
                  </div>
                {/if}
              {:else if r.state === 'open'}
                {#each r.options as o (o.id)}
                  <button
                    onclick={() => pick(o.id)}
                    disabled={busy || isBlocked(o)}
                    class="flex w-full items-center gap-3 py-2 text-left first:pt-0"
                  >
                    <span class="h-2 w-2 shrink-0 rounded-[2px] bg-violet-400"></span>
                    <span class="min-w-0 flex-1">
                      <span class="display block text-sm text-ink-100">{o.name}</span>
                      <span class="mt-0.5 block text-xs text-ink-400">{o.description}</span>
                    </span>
                    <span
                      class="shrink-0 text-xs {isBlocked(o) ? 'text-ember-300' : 'text-violet-300'}"
                    >
                      {isBlocked(o) ? unmetOf(o) : 'Choose'}
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

      {#if bandGroups}
        <!-- A metal is a band (§13.5.3): one shared score, a dropdown of the whole
             set, and the next metal opening at Lv 40. -->
        <div class="mt-3 flex flex-col gap-3">
          {#each bandGroups.groups as g (g.band.id)}
            {@const b = g.band}
            {@const open = b.gearUnlocked < b.gearTotal || g.actions.some((a) => a.unlocked)}
            <details class="panel px-2.5 py-2" {open}>
              <summary
                class="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 select-none"
              >
                <span class="text-base" aria-hidden="true">{b.icon}</span>
                <span class="display text-sm font-semibold text-ink-100">{b.name}</span>
                <span class="display text-sm font-bold tabular-nums" style="color: {accent}"
                  >Lv {b.level}</span
                >
                <span class="text-[11px] text-ink-400">{b.gearUnlocked}/{b.gearTotal} gear</span>
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
                {#each g.actions as a (a.id)}<ActionRow
                    {a}
                    {accent}
                    {itemMap}
                    {ownedMap}
                    {sources}
                    {firstTrainableId}
                    {flash}
                    {now}
                    {busy}
                    onTrain={train}
                    onPickChoice={pickChoice}
                    onCancelRig={cancelRig}
                  />{/each}
              </ul>
            </details>
          {/each}
          {#if bandGroups.other.length}
            <ul class="flex flex-col gap-1.5">
              {#each bandGroups.other as a (a.id)}<ActionRow
                  {a}
                  {accent}
                  {itemMap}
                  {ownedMap}
                  {sources}
                  {firstTrainableId}
                  {flash}
                  {now}
                  {busy}
                  onTrain={train}
                  onPickChoice={pickChoice}
                  onCancelRig={cancelRig}
                />{/each}
            </ul>
          {/if}
        </div>
      {:else}
        <ul class="mt-2 flex flex-col gap-1.5">
          {#each skill.actions as a (a.id)}<ActionRow
              {a}
              {accent}
              {itemMap}
              {ownedMap}
              {sources}
              {firstTrainableId}
              {flash}
              {now}
              {busy}
              onTrain={train}
              onPickChoice={pickChoice}
              onCancelRig={cancelRig}
            />{/each}
        </ul>
      {/if}
      <div class="h-4"></div>
    </div>
  </div>
{:else}
  <p class="mt-4 text-sm text-ink-400">Profession not found.</p>
{/if}
