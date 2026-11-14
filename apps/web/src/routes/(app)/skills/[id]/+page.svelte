<script lang="ts">
  import { href } from '#lib/paths'
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import { chooseTalent, getSkill, type ActionDTO, type SkillPageResponse } from '#lib/skills'
  import { CATEGORY, accentStyle, categoryAccent } from '#lib/theme'

  let data = $state<SkillPageResponse | null>(null)
  let error = $state('')
  let note = $state('')
  let loading = $state(true)
  let busy = $state(false)
  let changing = $state<string | null>(null)

  const id = $derived(page.params.id)
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const skill = $derived(data?.skill ?? null)
  const accent = $derived(skill ? categoryAccent(skill.category) : '#4fb0e8')
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

<div class="pt-5 pb-3">
  <button onclick={() => goto(href('/skills'))} class="text-sm text-ink-400 hover:text-ink-300">
    ← Professions
  </button>
</div>

{#if error}
  <p class="mb-3 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>
{/if}
{#if note}
  <p class="mb-3 rounded-lg bg-emerald-950/60 px-3 py-2 text-sm text-emerald-300">{note}</p>
{/if}

{#if loading}
  <p class="text-sm text-ink-400">Loading…</p>
{:else if skill}
  <!-- Header ---------------------------------------------------------------->
  <section class="panel panel-accent p-4" style={accentStyle(accent)}>
    <div class="flex items-center gap-3">
      <span
        class="grid h-14 w-14 shrink-0 place-items-center rounded-xl border text-3xl"
        style="border-color: {accent}66; background: {accent}1f">{skill.icon}</span
      >
      <div class="min-w-0 flex-1">
        <h1 class="display text-2xl" style="color: {accent}">{skill.name}</h1>
        <p class="text-xs text-ink-400">{catLabel} · {skill.description}</p>
      </div>
      <div class="level-badge px-2.5 py-1 text-base">{skill.level}</div>
    </div>

    <div class="bar mt-4">
      <i style="width: {skill.progress * 100}%"></i>
    </div>
    <div class="mt-1.5 flex justify-between text-[11px] text-ink-400">
      <span>{skill.intoLevel} / {skill.forNext} xp</span>
      <span>{skill.xp} xp total</span>
    </div>

    <p
      class="mt-3 flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-950/40 px-3 py-2 text-xs text-ink-300"
    >
      <span class="chip" style={accentStyle(accent)}>{pct(skill.effect.value)}</span>
      {skill.effectLabel}
    </p>

    {#if skill.category === 'combat'}
      <a
        href={href('/combat')}
        class="btn mt-3 w-full"
        style="color:#08111b; background: {accent}; border: 1px solid color-mix(in oklab, {accent} 65%, black)"
        >⚔️ Go to combat →</a
      >
    {/if}
  </section>

  <!-- Talents --------------------------------------------------------------->
  <h2 class="eyebrow mt-6 mb-2" style="color: {accent}">Talents</h2>

  {#if skill.talent.pendingChoice}
    <div class="panel panel-accent p-4" style={accentStyle('#e8c264')}>
      <p class="mb-3 text-sm text-gold-200">
        🎉 Level {skill.talent.milestone} — choose one talent:
      </p>
      <div class="grid gap-2">
        {#each skill.talent.options as o (o.id)}
          <button
            onclick={() => pick(o.id)}
            disabled={busy}
            class="rounded-xl border border-gold-600/60 bg-gold-500/10 px-3 py-3 text-left hover:bg-gold-500/15 disabled:opacity-50"
          >
            <span class="display block text-sm text-gold-200">{o.name}</span>
            <span class="block text-xs text-ink-400">{o.description}</span>
          </button>
        {/each}
      </div>
    </div>
  {:else}
    <p
      class="panel panel-accent mb-2 px-3 py-2 text-xs text-ink-300"
      style={accentStyle('#e8c264')}
    >
      No talent waiting. Next choice at
      <span class="gold">Lv {skill.talent.nextMilestone}</span>.
    </p>
  {/if}

  {#if skill.talent.owned.length}
    <div class="mt-2 space-y-2">
      {#each skill.talent.owned as t (t.id)}
        <div class="panel panel-accent p-3" style={accentStyle('#e8c264')}>
          <div class="flex items-start gap-3">
            <span class="text-lg">🔹</span>
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline justify-between gap-2">
                <span class="display text-sm text-gold-200">{t.name}</span>
                <span class="level-badge text-[11px]">Lv {t.milestone}</span>
              </div>
              <p class="text-xs text-ink-300">{t.description}</p>
            </div>
          </div>

          <button
            onclick={() => (changing = changing === t.id ? null : t.id)}
            class="mt-2 text-[11px] text-emerald-400 hover:text-emerald-300"
          >
            {changing === t.id ? 'Cancel' : 'Change talent'}
          </button>
          {#if changing === t.id}
            <div class="mt-2 grid gap-2">
              {#each t.options.filter((o) => o.id !== t.id) as o (o.id)}
                <button
                  onclick={() => pick(o.id)}
                  disabled={busy}
                  class="rounded-xl border border-ink-600 bg-ink-900/60 px-3 py-2 text-left hover:border-ink-500 disabled:opacity-50"
                >
                  <span class="display block text-sm text-ink-300">{o.name}</span>
                  <span class="block text-xs text-ink-400">{o.description}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <p class="panel panel-accent p-3 text-xs text-ink-300" style={accentStyle('#e8c264')}>
      No talents yet — reach <span class="gold">Lv {skill.talent.nextMilestone}</span> to pick your first.
    </p>
  {/if}

  <!-- Actions --------------------------------------------------------------->
  <h2 class="eyebrow mt-6 mb-2" style="color: {accent}">Actions</h2>
  <div class="space-y-2">
    {#each skill.actions as a (a.id)}
      <div
        class="panel panel-accent p-3"
        class:opacity-60={!a.unlocked}
        style={accentStyle(accent)}
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="display text-sm text-ink-300">{a.name}</div>
            <div class="text-[11px] text-ink-400">{a.description}</div>
            <div class="mt-1 flex flex-wrap gap-1 text-[11px]">
              {#each a.consumes ?? [] as c (c.item)}
                <span class="chip" style="--accent: #6b7a96">
                  −{c.count}
                  {itemMap.get(c.item)?.icon ?? ''}
                  {itemMap.get(c.item)?.name ?? c.item}
                </span>
              {/each}
              {#each a.produces ?? [] as p (p.item)}
                <span class="chip" style="--accent: #58c46b">
                  +{p.count}
                  {itemMap.get(p.item)?.icon ?? ''}
                  {itemMap.get(p.item)?.name ?? p.item}
                </span>
              {/each}
              <span class="chip" style="--accent: #4fb0e8">+{a.xp} xp</span>
            </div>
          </div>
          <button
            onclick={() => train(a)}
            disabled={!a.unlocked || !a.affordable}
            class="btn btn-accent shrink-0 px-3 py-2 text-sm"
            style={accentStyle(accent)}
          >
            Train
          </button>
        </div>
        {#if !a.unlocked || !a.affordable}
          <p class="mt-1 text-[11px] text-amber-300">
            {a.unlocked ? 'needs' : 'locked —'}
            {lockedReason(a)}
          </p>
        {/if}
      </div>
    {/each}
  </div>
  <div class="h-6"></div>
{:else}
  <p class="text-sm text-ink-400">Profession not found.</p>
{/if}
