<script lang="ts">
  import { href } from '#lib/paths'
  import { onMount } from 'svelte'
  import type { ActionDTO, SkillDTO } from '#lib/skills'
  import { useSkills } from '#lib/skills/store.svelte'
  import { fmtInterval, rigGainedSince, rigSecondsLeft } from '#lib/idle'
  import { ACCENT, CATEGORY, accentStyle, type SkillCategory } from '#lib/theme'
  import Icon from '#lib/components/Icon.svelte'
  import Spinner from '#lib/components/Spinner.svelte'
  import SkillCard from '#lib/components/skill/SkillCard.svelte'

  const board = useSkills()
  const data = $derived(board.data ?? null)

  const pct = (v: number) => `${Math.round(v * 100)}%`
  const compact = (n: number) =>
    n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString()
  const totalXp = $derived(board.skills.reduce((n, s) => n + s.xp, 0))
  const EMBLEM: Record<SkillCategory, string> = {
    gathering: '⛏️',
    artisan: '🔨',
    support: '🧭',
    combat: '⚔️',
  }
  const totalLevel = $derived.by(() => {
    const skills = board.skills
    if (!skills.length) return 1
    return Math.round(skills.reduce((n, s) => n + s.level, 0) / skills.length)
  })
  const pendingTalents = $derived(
    board.skills.filter((s) => s.talent.pendingChoice || s.talent.mastery.pending.length > 0),
  )

  const groups = $derived(
    (['gathering', 'artisan', 'support', 'combat'] as SkillCategory[])
      .map((key) => ({
        key,
        ...CATEGORY[key],
        emblem: EMBLEM[key],
        skills: board.skills.filter((s) => s.category === key),
      }))
      .map((g) => ({ ...g, levels: g.skills.reduce((n, s) => n + s.level, 0) })),
  )

  interface RunningRig {
    id: string
    name: string
    accent: string
    gained: number
    actionId: string
    left: number
    rate: string
    count: number
  }

  function runningRigs(skills: SkillDTO[], fetchedAt: number, now: number): RunningRig[] {
    const out: RunningRig[] = []
    for (const s of skills) {
      const rig = runningIn(s, fetchedAt, now)
      if (rig) out.push(rig)
    }
    return out.sort((a, b) => a.left - b.left)
  }

  function runningIn(s: SkillDTO, fetchedAt: number, now: number): RunningRig | undefined {
    const active = s.actions.filter((a) => a.idle?.active)
    if (!active.length) return undefined
    const soonest = active.reduce((min, a) =>
      rigSecondsLeft(a.idle!, now) < rigSecondsLeft(min.idle!, now) ? a : min,
    )
    return {
      id: s.id,
      name: s.name,
      accent: CATEGORY[s.category].accent,
      gained: fetchedAt ? gainedSince(active, fetchedAt, now) : 0,
      actionId: soonest.id,
      left: rigSecondsLeft(soonest.idle!, now),
      rate: fmtInterval(soonest.idle!.intervalSec),
      count: active.length,
    }
  }

  function gainedSince(actions: ActionDTO[], fetchedAt: number, now: number): number {
    let gained = 0
    for (const a of actions) {
      for (const n of Object.values(rigGainedSince(a.idle!, fetchedAt, now))) gained += n
    }
    return gained
  }

  const running = $derived(runningRigs(board.skills, board.fetchedAt, board.now))

  const runningById = $derived(new Map(running.map((r) => [r.id, r])))

  onMount(() => {
    void board.refresh()
  })
</script>

<div class="border-b border-ink-700 pt-4 pb-4">
  <h1 class="display text-3xl text-ink-100">Skills</h1>
  <p class="sub mt-2">Train a trade, gather materials, grow stronger.</p>
</div>

{#if board.error}
  <p class="banner mt-3" style={accentStyle(ACCENT.ember)} role="alert">{board.error}</p>
{/if}

{#if data}
  <div class="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
    <div class="stile" style={accentStyle(ACCENT.seal)}>
      <span class="stile__icon" aria-hidden="true"><Icon name="trophy" size={20} /></span>
      <div class="min-w-0">
        <div class="stile__value">{totalLevel}</div>
        <div class="stile__label">Level</div>
      </div>
    </div>
    <div class="stile" style={accentStyle(ACCENT.gold)}>
      <span class="stile__icon" aria-hidden="true"><Icon name="star" size={20} /></span>
      <div class="min-w-0">
        <div class="stile__value">{compact(totalXp)}</div>
        <div class="stile__label">Total XP</div>
      </div>
    </div>
    <div class="stile" style={accentStyle(ACCENT.jade)}>
      <span class="stile__icon" aria-hidden="true">⚙️</span>
      <div class="min-w-0">
        <div class="stile__value">{running.length}</div>
        <div class="stile__label">Rigs running</div>
      </div>
    </div>
    <div class="stile" style={accentStyle(ACCENT.violet)}>
      <span class="stile__icon" aria-hidden="true">✨</span>
      <div class="min-w-0">
        <div class="stile__value">{pendingTalents.length}</div>
        <div class="stile__label">Talents ready</div>
      </div>
    </div>
  </div>

  <div class="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
    <span class="mr-1 text-ink-400">Bonuses</span>
    <span class="chip" style={accentStyle(ACCENT.gold)}>+{pct(data.bonuses.globalXp)} XP</span>
    <span class="chip" style={accentStyle(CATEGORY.combat.accent)}
      >+{pct(data.bonuses.damage)} power</span
    >
    <span class="chip" style={accentStyle(CATEGORY.support.accent)}
      >+{pct(data.bonuses.drop)} drops</span
    >
  </div>
{/if}

{#if pendingTalents.length}
  <a
    href={href(`/skills/${pendingTalents[0]!.id}`)}
    class="gcard mt-4 flex min-h-11 items-center gap-3 p-3 pt-3.5 text-sm"
    style={accentStyle(ACCENT.violet)}
  >
    <span class="medal" aria-hidden="true">✨</span>
    <span class="min-w-0 flex-1">
      <span class="display block text-ink-100">A talent is ready</span>
      <span class="block truncate text-xs text-violet-300"
        >{pendingTalents.map((s) => s.name).join(', ')}</span
      >
    </span>
    <span class="text-ink-400" aria-hidden="true">→</span>
  </a>
{/if}

<a
  href={href('/combat')}
  class="gcard mt-4 flex min-h-11 items-center gap-3 p-3 pt-3.5 text-sm"
  style={accentStyle(CATEGORY.combat.accent)}
>
  <span class="medal" aria-hidden="true"><Icon name="skull" size={24} /></span>
  <span class="min-w-0 flex-1">
    <span class="display block text-ink-100">Combat</span>
    <span class="block text-xs text-ink-400">Fight monsters for bones, hides and gems</span>
  </span>
  <span class="btn btn-ghost pointer-events-none min-h-9 px-3 py-1.5 text-xs">Fight →</span>
</a>

{#if running.length}
  <div class="mt-4 flex flex-wrap items-center gap-2 text-xs">
    <span class="livedot" style={accentStyle(ACCENT.jade)}></span>
    <span class="text-ink-400">Running</span>
    {#each running as r (r.id)}
      <a href={href(`/skills/${r.id}`)} class="chip" style={accentStyle(r.accent)}>
        {r.name}
        <span class="display tabular-nums">{r.gained}</span>
      </a>
    {/each}
  </div>
{/if}

{#if board.loading}
  <p class="banner mt-4" style={accentStyle(ACCENT.azure)}>
    <Spinner size={14} label="Loading skills" /> Loading…
  </p>
{:else}
  <div class="pb-8 xl:columns-2 xl:gap-x-10">
    {#each groups as g (g.key)}
      {#if g.skills.length}
        <section class="pt-7 xl:break-inside-avoid" style={accentStyle(g.accent)}>
          <div class="sbanner">
            <span class="sbanner__emblem" aria-hidden="true">{g.emblem}</span>
            <div class="min-w-0">
              <h2 class="sbanner__title">{g.label}</h2>
              <div class="sbanner__meta">
                {g.skills.length} skill{g.skills.length === 1 ? '' : 's'} · {g.levels} levels
              </div>
            </div>
            <span class="sbanner__rule" aria-hidden="true"></span>
          </div>
          <ul class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 xl:grid-cols-2">
            {#each g.skills as s (s.id)}
              <li>
                <SkillCard skill={s} accent={g.accent} live={runningById.get(s.id)} />
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/each}
  </div>
{/if}
