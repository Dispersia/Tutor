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
  import { peekCached } from '#lib/cache'
  import { buildBandGroups, buildTalentRail, distillablesOf } from '#lib/skillview'
  import DistillPanel from '#lib/components/skill/DistillPanel.svelte'
  import SkillLedger from '#lib/components/skill/SkillLedger.svelte'
  import TalentRail from '#lib/components/skill/TalentRail.svelte'
  import ActionList from '#lib/components/skill/ActionList.svelte'

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
  const distillables = $derived(distillablesOf(skill?.id, data?.inventory ?? [], itemMap))

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
    <DistillPanel {accent} {distillables} note={distillNote} {busy} onDistill={doDistill} />
  {/if}

  <!-- Mobile order is ledger → actions → talents: the thing you actually do comes
       before the long-term ladder. At xl the two columns return, with the ledger
       and its talents in the left column and actions on the right. -->
  <div
    class="flex flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] xl:items-start xl:gap-x-24"
  >
    <div class="order-1 xl:order-none xl:col-start-1 xl:row-start-1">
      <SkillLedger {skill} {accent} {rigs} fedBy={data?.fedBy ?? []} />
    </div>

    <div class="order-3 xl:order-none xl:col-start-1 xl:row-start-2">
      <TalentRail
        {skill}
        {rail}
        {changing}
        {busy}
        onPick={pick}
        onChange={(talentId) => (changing = talentId)}
      />
    </div>

    <div class="order-2 xl:order-none xl:col-start-2 xl:row-start-1 xl:row-span-2">
      <ActionList
        {skill}
        {bandGroups}
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
      />
      <div class="h-4"></div>
    </div>
  </div>
{:else}
  <p class="mt-4 text-sm text-ink-400">Profession not found.</p>
{/if}
