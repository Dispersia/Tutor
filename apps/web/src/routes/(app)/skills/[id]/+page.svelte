<script lang="ts">
  import { href } from '#lib/paths'
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import { chooseTalent, getSkill, type ActionDTO, type SkillPageResponse } from '#lib/skills'
  import { CATEGORY, ACCENT, accentStyle, categoryAccent } from '#lib/theme'
  import Icon from '#lib/components/Icon.svelte'

  let data = $state<SkillPageResponse | null>(null)
  let error = $state('')
  let note = $state('')
  let loading = $state(true)
  let busy = $state(false)
  let changing = $state<string | null>(null)

  const id = $derived(page.params.id)
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const skill = $derived(data?.skill ?? null)
  const accent = $derived(skill ? categoryAccent(skill.category) : ACCENT.azure)
  const catLabel = $derived(skill ? CATEGORY[skill.category].label : '')
  const itemMap = $derived(new Map((data?.items ?? []).map((i) => [i.id, i])))

  $effect(() => {
    const current = id
    if (!current) return
    void load(current)
  })

  async function load(skillId: string) {
    loading = true
    error = ''
    try {
      data = await getSkill(skillId)
    } catch (e) {
      error = (e as Error).message
      data = null
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
    void goto(href(`/practice?action=${a.id}`))
  }

  function lockedReason(a: ActionDTO): string {
    if (a.missingUnlocks.length) {
      return a.missingUnlocks.map((u) => `${u.skill} ${u.level}`).join(', ')
    }
    if (a.equipMissing) return `equip a ${a.equipMissing.tag} ${a.equipMissing.slot}`
    if (a.missing.length)
      return `need ${a.missing.map((m) => `${m.count}× ${itemMap.get(m.item)?.name ?? m.item}`).join(', ')}`
    return ''
  }
</script>

<div class="pt-5">
  <button onclick={() => goto(href('/skills'))} class="text-sm text-ink-400 hover:text-ink-200">
    ← Skills
  </button>
</div>

{#if error}
  <p class="mt-3 rounded-[4px] bg-ember-950 px-3 py-2 text-sm text-ember-300">{error}</p>
{/if}
{#if note}
  <p class="mt-3 rounded-[4px] bg-jade-950 px-3 py-2 text-sm text-jade-300">{note}</p>
{/if}

{#if loading}
  <p class="mt-4 text-sm text-ink-400">Loading…</p>
{:else if skill}
  <!-- Header ---------------------------------------------------------------->
  <header
    class="mt-3 flex items-center justify-between gap-3 border-b border-ink-700 pb-4"
    style={accentStyle(accent)}
  >
    <div class="min-w-0">
      <h1 class="display truncate text-3xl text-ink-100">{skill.name}</h1>
      <p class="mt-1 text-xs text-ink-400">{catLabel} · {skill.description}</p>
    </div>
    <div
      class="grid h-14 w-14 shrink-0 place-items-center rounded-[4px]"
      style="border: 1.5px solid {accent}; background: {accent}1f; color: {accent}"
      aria-label="Level {skill.level} of 100, the average of {skill.actions.length} actions"
    >
      <span class="display text-2xl leading-none font-bold">{skill.level}</span>
      <span class="text-[8px] tracking-[0.16em]">LEVEL</span>
    </div>
  </header>

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
        <span class="text-ink-500 tabular-nums">{pct(skill.progress)} avg</span>
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
    {#if skill.category === 'combat'}
      <a
        href={href('/combat')}
        class="flex items-center gap-2 border-b border-ink-700 py-3 text-sm"
        style={accentStyle(accent)}
      >
        <Icon name="skull" size={17} />
        <span class="flex-1 text-ink-100">Go to combat</span>
        <span class="text-ink-500">→</span>
      </a>
    {/if}
  </section>

  <!-- Talents --------------------------------------------------------------->
  <h2 class="mt-6 text-xs font-bold tracking-widest uppercase" style="color: {accent}">Talents</h2>

  {#if skill.talent.pendingChoice}
    <p class="mt-2 border-b border-ink-700 pb-3 text-sm text-ink-300">
      Level {skill.talent.milestone} — choose one:
    </p>
    <ul>
      {#each skill.talent.options as o (o.id)}
        <li>
          <button
            onclick={() => pick(o.id)}
            disabled={busy}
            class="flex w-full items-center gap-3 border-b border-ink-700 py-3 text-left disabled:opacity-50"
            style={accentStyle(ACCENT.gold)}
          >
            <span class="h-2 w-2 shrink-0 rounded-[2px]" style="background: var(--accent)"></span>
            <span class="min-w-0 flex-1">
              <span class="display block text-sm text-ink-100">{o.name}</span>
              <span class="mt-0.5 block text-xs text-ink-400">{o.description}</span>
            </span>
            <span class="shrink-0 text-xs text-gold-300">Choose</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="mt-2 border-b border-ink-700 py-3 text-xs text-ink-400">
      No talent waiting. Next choice at <span class="gold">Lv {skill.talent.nextMilestone}</span>.
    </p>
  {/if}

  {#if skill.talent.owned.length}
    <ul class="mt-2">
      {#each skill.talent.owned as t (t.id)}
        <li class="border-b border-ink-700 py-3" style={accentStyle(ACCENT.gold)}>
          <div class="flex items-baseline justify-between gap-2">
            <span class="display text-sm text-ink-100">{t.name}</span>
            <span class="text-[11px] text-ink-500">Lv {t.milestone}</span>
          </div>
          <p class="mt-0.5 text-xs text-ink-400">{t.description}</p>
          <button
            onclick={() => (changing = changing === t.id ? null : t.id)}
            class="mt-1 text-[11px] text-ink-400 underline hover:text-ink-200"
          >
            {changing === t.id ? 'Cancel' : 'Change talent'}
          </button>
          {#if changing === t.id}
            <div class="mt-2">
              {#each t.options.filter((o) => o.id !== t.id) as o (o.id)}
                <button
                  onclick={() => pick(o.id)}
                  disabled={busy}
                  class="flex w-full items-center gap-3 border-t border-ink-700 py-2.5 text-left disabled:opacity-50"
                >
                  <span class="min-w-0 flex-1">
                    <span class="display block text-sm text-ink-200">{o.name}</span>
                    <span class="block text-xs text-ink-400">{o.description}</span>
                  </span>
                  <span class="shrink-0 text-xs text-ink-500">Pick</span>
                </button>
              {/each}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="mt-2 border-b border-ink-700 py-3 text-xs text-ink-400">
      No talents yet — reach <span class="gold">Lv {skill.talent.nextMilestone}</span> to pick your first.
    </p>
  {/if}

  <!-- Actions --------------------------------------------------------------->
  <h2 class="mt-6 text-xs font-bold tracking-widest uppercase" style="color: {accent}">Actions</h2>
  <ul>
    {#each skill.actions as a (a.id)}
      <li
        class="flex items-start gap-3 border-b border-ink-700 py-3"
        class:opacity-60={!a.unlocked}
        style={accentStyle(accent)}
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-sm font-medium text-ink-100">{a.name}</span>
            <span class="display shrink-0 text-sm font-bold" style="color: {accent}"
              >Lv {a.level}</span
            >
          </div>
          <div class="bar mt-1.5"><i style="width: {a.progress * 100}%"></i></div>
          <div class="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-ink-500">
            <span class="tabular-nums">+{a.xp} xp</span>
            <span style="color: {accent}">now {pct(a.effect.value)}</span>
          </div>
          <div class="mt-0.5 text-[11px] text-ink-400">{a.description}</div>
          {#if (a.consumes ?? []).length || (a.produces ?? []).length}
            <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              {#each a.consumes ?? [] as c (c.item)}
                <span class="text-ember-300">
                  −{c.count}
                  {itemMap.get(c.item)?.icon ?? ''}
                  {itemMap.get(c.item)?.name ?? c.item}
                </span>
              {/each}
              {#each a.produces ?? [] as p (p.item)}
                <span class="text-jade-400">
                  +{p.count}
                  {itemMap.get(p.item)?.icon ?? ''}
                  {itemMap.get(p.item)?.name ?? p.item}
                </span>
              {/each}
            </div>
          {/if}
          {#if !a.unlocked || !a.affordable}
            <p class="mt-1 text-[11px] text-brass-300">
              {a.unlocked ? 'needs' : 'locked —'}
              {lockedReason(a)}
            </p>
          {/if}
        </div>
        <button
          onclick={() => train(a)}
          disabled={!a.unlocked || !a.affordable}
          class="btn {a.unlocked && a.affordable
            ? 'btn-primary'
            : 'btn-ghost'} shrink-0 px-3 py-2 text-sm"
        >
          Train
        </button>
      </li>
    {/each}
  </ul>
  <div class="h-6"></div>
{:else}
  <p class="mt-4 text-sm text-ink-400">Profession not found.</p>
{/if}
