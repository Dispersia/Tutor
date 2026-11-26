<script lang="ts">
  import { href } from '#lib/paths'
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import { tick } from 'svelte'
  import {
    applyEnchant,
    chooseAction,
    chooseTalent,
    distillGear,
    setDistillMode,
    stopRig,
    toggleDistill,
    type ActionDTO,
    type DistillConfigDTO,
    type SkillPageResponse,
  } from '#lib/skills'
  import { CATEGORY, ACCENT, accentStyle, categoryAccent } from '#lib/theme'
  import { cachedResource } from '#lib/resource.svelte'
  import { clock } from '#lib/clock.svelte'
  import { anyRigActive } from '#lib/idle'
  import { buildBandGroups, buildTalentRail, queuedDistillables } from '#lib/skillview'
  import DistillPanel from '#lib/components/skill/DistillPanel.svelte'
  import EnchantPanel from '#lib/components/skill/EnchantPanel.svelte'
  import SkillLedger from '#lib/components/skill/SkillLedger.svelte'
  import TalentRail from '#lib/components/skill/TalentRail.svelte'
  import ActionList from '#lib/components/skill/ActionList.svelte'
  import ConfirmDialog from '#lib/components/ConfirmDialog.svelte'
  import Spinner from '#lib/components/Spinner.svelte'

  const id = $derived(page.params.id)
  const profession = cachedResource<SkillPageResponse>(() =>
    id ? `/api/skills/${encodeURIComponent(id)}` : undefined,
  )
  const data = $derived(profession.data ?? null)
  let note = $state('')
  let busy = $state(false)
  let changing = $state<string | null>(null)
  let flash = $state<string | null>(null)
  let pendingRig = $state<ActionDTO | null>(null)
  let highlighted = ''

  const skill = $derived(data?.skill ?? null)
  const now = $derived(skill && anyRigActive([skill]) ? clock.now : Date.now())
  const accent = $derived(skill ? categoryAccent(skill.category) : ACCENT.azure)
  const rigs = $derived(data?.rigs ?? { maxLive: 2, live: 0 })
  const catLabel = $derived(skill ? CATEGORY[skill.category].label : '')
  const itemMap = $derived(new Map((data?.items ?? []).map((i) => [i.id, i])))
  const ownedMap = $derived(new Map((data?.inventory ?? []).map((i) => [i.itemId, i.count])))
  const sources = $derived(data?.sources ?? {})
  const firstTrainableId = $derived(skill?.actions.find((a) => a.unlocked && a.affordable)?.id)

  let distillNote = $state('')
  const distillConfig = $derived<DistillConfigDTO>(
    data?.distill ?? { mode: 'max-value', allow: [] },
  )
  const queued = $derived.by(() => {
    const worn = new Map<string, number>()
    for (const e of data?.equipment ?? []) worn.set(e.itemId, (worn.get(e.itemId) ?? 0) + 1)
    const spare = (data?.inventory ?? []).map((row) => ({
      itemId: row.itemId,
      count: Math.max(0, row.count - (worn.get(row.itemId) ?? 0)),
    }))
    return queuedDistillables(distillConfig, spare, itemMap)
  })

  async function pickDistillMode(mode: string) {
    busy = true
    profession.error = ''
    try {
      await setDistillMode(mode)
      await load()
    } catch (e) {
      profession.error = (e as Error).message
    } finally {
      busy = false
    }
  }

  async function toggleDistillItem(itemId: string) {
    busy = true
    profession.error = ''
    try {
      await toggleDistill(itemId)
      await load()
    } catch (e) {
      profession.error = (e as Error).message
    } finally {
      busy = false
    }
  }

  async function doDistill(itemId: string) {
    busy = true
    distillNote = ''
    try {
      const res = await distillGear(itemId)
      distillNote = `+${res.xp} Enchanting XP · +1 ${res.essence.replaceAll('_', ' ')}`
      await load()
    } catch (e) {
      profession.error = (e as Error).message
    } finally {
      busy = false
    }
  }

  async function doEnchant(instanceId: string, enchantId: string) {
    busy = true
    profession.error = ''
    try {
      await applyEnchant(instanceId, enchantId)
      await load()
    } catch (e) {
      profession.error = (e as Error).message
    } finally {
      busy = false
    }
  }

  const bandGroups = $derived(skill ? buildBandGroups(skill) : null)

  const rail = $derived(skill ? buildTalentRail(skill) : [])

  $effect(() => {
    const hash = page.url.hash
    if (!hash) highlighted = ''
    if (!hash || !id || skill?.id !== id) return
    const key = `${id}${hash}`
    if (key === highlighted) return
    highlighted = key
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

  async function load() {
    profession.error = ''
    await profession.refresh()
  }

  async function pick(talentId: string) {
    note = ''
    busy = true
    try {
      await chooseTalent(talentId)
      note = 'Talent saved.'
      changing = null
      await load()
    } catch (e) {
      profession.error = (e as Error).message
    } finally {
      busy = false
    }
  }

  function train(a: ActionDTO) {
    const choice = a.choices?.length ? `&choice=${encodeURIComponent(a.choice)}` : ''
    void goto(href(`/practice?action=${a.id}${choice}`))
  }

  async function pickChoice(a: ActionDTO, choiceId: string) {
    busy = true
    profession.error = ''
    try {
      await chooseAction(a.id, choiceId)
      await load()
    } catch (e) {
      profession.error = (e as Error).message
    } finally {
      busy = false
    }
  }

  function cancelRig(a: ActionDTO) {
    pendingRig = a
  }

  async function confirmStopRig() {
    const a = pendingRig
    if (!a) return
    pendingRig = null
    busy = true
    profession.error = ''
    try {
      await stopRig(a.id)
      await load()
    } catch (e) {
      profession.error = (e as Error).message
    } finally {
      busy = false
    }
  }
</script>

<div class="pt-4">
  <button onclick={() => goto(href('/skills'))} class="link link-btn text-sm">← Skills</button>
</div>

{#if profession.error}
  <p class="banner mt-3" style={accentStyle(ACCENT.ember)} role="alert">{profession.error}</p>
{/if}
{#if note}
  <p class="banner mt-3" style={accentStyle(ACCENT.jade)}>{note}</p>
{/if}

{#if profession.loading}
  <p class="banner mt-4 flex items-center gap-2" style={accentStyle(ACCENT.azure)}>
    <Spinner size={16} label="Loading this profession" /> Loading…
  </p>
{:else if skill}
  <header class="mt-3 border-b border-ink-700 pb-4 mb-4" style={accentStyle(accent)}>
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h1 class="display min-w-0 truncate text-3xl text-ink-100">{skill.name}</h1>
        <p class="sub mt-2">{catLabel} · {skill.description}</p>
      </div>
      <div class="shrink-0 text-center">
        <div
          class="tile grid h-14 w-14 place-items-center"
          role="img"
          aria-label="Level {skill.level} of 100, the average of {skill.actions.length} actions"
        >
          <span class="display text-xl leading-none font-bold" style="color: {accent}"
            >{skill.level}</span
          >
        </div>
        <p class="seal__label" aria-hidden="true">Level</p>
      </div>
    </div>
  </header>

  {#if skill.id === 'enchanting'}
    <DistillPanel
      {accent}
      {queued}
      config={distillConfig}
      note={distillNote}
      {busy}
      onDistill={doDistill}
      onToggle={toggleDistillItem}
      onMode={pickDistillMode}
    />
    <EnchantPanel
      {accent}
      enchants={data?.enchants ?? []}
      level={data?.enchantingLevel ?? 1}
      gear={data?.gear ?? []}
      sets={data?.sets ?? []}
      equipment={data?.equipment ?? []}
      {itemMap}
      owned={ownedMap}
      {busy}
      onEnchant={doEnchant}
    />
  {/if}

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
{:else if !profession.error}
  <p class="mt-4 text-sm text-ink-400">Profession not found.</p>
{/if}

<ConfirmDialog
  open={pendingRig !== null}
  title="Stop rig"
  message={`Stop the ${pendingRig?.name ?? 'this'} rig? Its run ends now and frees a slot for another action.`}
  confirmLabel="Stop rig"
  {busy}
  onConfirm={confirmStopRig}
  onCancel={() => (pendingRig = null)}
/>
