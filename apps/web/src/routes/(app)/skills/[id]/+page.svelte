<script lang="ts">
  import { href } from '#lib/paths'
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import { chooseTalent, getSkill, type ActionDTO, type SkillPageResponse } from '#lib/skills'

  let data = $state<SkillPageResponse | null>(null)
  let error = $state('')
  let note = $state('')
  let loading = $state(true)
  let busy = $state(false)
  let changing = $state<string | null>(null)

  const id = $derived(page.params.id)
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const skill = $derived(data?.skill ?? null)
  const itemMap = $derived(new Map((data?.items ?? []).map((i) => [i.id, i])))

  const CATEGORY_LABEL = {
    gathering: 'Gathering',
    artisan: 'Artisan',
    support: 'Support',
    combat: 'Combat',
  } as const

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

<div class="flex items-center gap-3 pt-4 pb-3">
  <button onclick={() => goto(href('/skills'))} class="text-sm text-neutral-400"
    >← Professions</button
  >
</div>

{#if error}
  <p class="mb-3 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>
{/if}
{#if note}
  <p class="mb-3 rounded-lg bg-emerald-950/60 px-3 py-2 text-sm text-emerald-300">{note}</p>
{/if}

{#if loading}
  <p class="text-sm text-neutral-500">Loading…</p>
{:else if skill}
  <!-- Header -------------------------------------------------------------->
  <section class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
    <div class="flex items-center gap-3">
      <span class="text-4xl">{skill.icon}</span>
      <div class="min-w-0 flex-1">
        <h1 class="text-lg font-semibold">{skill.name}</h1>
        <p class="text-xs text-neutral-500">
          {CATEGORY_LABEL[skill.category]} · {skill.description}
        </p>
      </div>
      <span class="rounded-full bg-neutral-800 px-3 py-1 text-sm">Lv {skill.level}</span>
    </div>

    <div class="mt-3 h-2 overflow-hidden rounded-full bg-neutral-800">
      <div
        class="h-full rounded-full bg-emerald-500 transition-all"
        style="width: {skill.progress * 100}%"
      ></div>
    </div>
    <div class="mt-1 flex justify-between text-[11px] text-neutral-500">
      <span>{skill.intoLevel} / {skill.forNext} xp</span>
      <span>{skill.xp} xp total</span>
    </div>

    <p class="mt-3 rounded-xl bg-neutral-800/60 px-3 py-2 text-xs text-neutral-300">
      {skill.effectLabel} · currently
      <span class="font-medium text-emerald-300">{pct(skill.effect.value)}</span>
    </p>

    {#if skill.category === 'combat'}
      <a
        href={href('/combat')}
        class="mt-3 block rounded-xl border border-neutral-700 px-3 py-2 text-center text-sm"
        >⚔️ Go to combat →</a
      >
    {/if}
  </section>

  <!-- Talents ------------------------------------------------------------->
  <h2 class="mt-6 mb-2 text-xs tracking-wide text-neutral-500 uppercase">Talents</h2>

  {#if skill.talent.pendingChoice}
    <div class="rounded-2xl border border-amber-700 bg-amber-950/20 p-4">
      <p class="mb-3 text-sm text-amber-200">
        🎉 Level {skill.talent.milestone} — choose one talent:
      </p>
      <div class="grid gap-2">
        {#each skill.talent.options as o (o.id)}
          <button
            onclick={() => pick(o.id)}
            disabled={busy}
            class="rounded-xl border border-amber-700/60 px-3 py-3 text-left hover:bg-amber-900/20 disabled:opacity-50"
          >
            <span class="text-sm font-medium">{o.name}</span>
            <span class="block text-xs text-neutral-400">{o.description}</span>
          </button>
        {/each}
      </div>
    </div>
  {:else}
    <p
      class="mb-3 rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-xs text-neutral-500"
    >
      No talent waiting. Next choice at <span class="text-neutral-300"
        >Lv {skill.talent.nextMilestone}</span
      >.
    </p>
  {/if}

  {#if skill.talent.owned.length}
    <div class="mt-2 space-y-2">
      {#each skill.talent.owned as t (t.id)}
        <div class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-3">
          <div class="flex items-start gap-3">
            <span class="text-lg">🔹</span>
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-sm font-medium">{t.name}</span>
                <span class="shrink-0 text-[11px] text-neutral-500">Lv {t.milestone}</span>
              </div>
              <p class="text-xs text-neutral-400">{t.description}</p>
            </div>
          </div>

          <button
            onclick={() => (changing = changing === t.id ? null : t.id)}
            class="mt-2 text-[11px] text-emerald-400"
          >
            {changing === t.id ? 'Cancel' : 'Change talent'}
          </button>
          {#if changing === t.id}
            <div class="mt-2 grid gap-2">
              {#each t.options.filter((o) => o.id !== t.id) as o (o.id)}
                <button
                  onclick={() => pick(o.id)}
                  disabled={busy}
                  class="rounded-xl border border-neutral-700 px-3 py-2 text-left hover:bg-neutral-800/60 disabled:opacity-50"
                >
                  <span class="text-sm font-medium">{o.name}</span>
                  <span class="block text-xs text-neutral-400">{o.description}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <p class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-3 text-xs text-neutral-500">
      No talents yet — reach <span class="text-neutral-300">Lv {skill.talent.nextMilestone}</span> to
      pick your first.
    </p>
  {/if}

  <!-- Actions ------------------------------------------------------------->
  <h2 class="mt-6 mb-2 text-xs tracking-wide text-neutral-500 uppercase">Actions</h2>
  <div class="space-y-2">
    {#each skill.actions as a (a.id)}
      <div class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-sm">{a.name}</div>
            <div class="text-[11px] text-neutral-500">{a.description}</div>
            <div class="mt-1 flex flex-wrap gap-1 text-[11px]">
              {#each a.consumes ?? [] as c (c.item)}
                <span class="rounded bg-neutral-800 px-1.5 py-0.5">
                  −{c.count}
                  {itemMap.get(c.item)?.icon ?? ''}
                  {itemMap.get(c.item)?.name ?? c.item}
                </span>
              {/each}
              {#each a.produces ?? [] as p (p.item)}
                <span class="rounded bg-emerald-900/40 px-1.5 py-0.5 text-emerald-200">
                  +{p.count}
                  {itemMap.get(p.item)?.icon ?? ''}
                  {itemMap.get(p.item)?.name ?? p.item}
                </span>
              {/each}
              <span class="rounded bg-sky-900/40 px-1.5 py-0.5 text-sky-200">+{a.xp} xp</span>
            </div>
          </div>
          <button
            onclick={() => train(a)}
            disabled={!a.unlocked || !a.affordable}
            class="shrink-0 rounded-xl bg-emerald-500 px-3 py-2 text-sm text-black disabled:opacity-40"
          >
            Train
          </button>
        </div>
        {#if !a.unlocked || !a.affordable}
          <p class="mt-1 text-[11px] text-amber-400">
            {a.unlocked ? 'needs' : 'locked —'}
            {lockedReason(a)}
          </p>
        {/if}
      </div>
    {/each}
  </div>
{:else}
  <p class="text-sm text-neutral-500">Profession not found.</p>
{/if}
