<script lang="ts">
  import { href } from '#lib/paths'
  import { onMount } from 'svelte'
  import {
    EFFECT_SHORT,
    getSkills,
    type ActionDTO,
    type SkillDTO,
    type SkillsResponse,
  } from '#lib/skills'
  import { fmtInterval, rigGainedSince, rigSecondsLeft } from '#lib/idle'
  import { ACCENT, CATEGORY, accentStyle, type SkillCategory } from '#lib/theme'
  import Icon from '#lib/components/Icon.svelte'
  import Spinner from '#lib/components/Spinner.svelte'
  import { cachedAt, peekCached } from '#lib/cache'

  // Seed from the last fetch so returning to Skills renders the board at once.
  const cachedSkills = peekCached<SkillsResponse>('/api/skills')
  let data = $state<SkillsResponse | null>(cachedSkills ?? null)
  let error = $state('')
  let loading = $state(cachedSkills === undefined)
  /** When the board was fetched — the cursor the live counters extrapolate from. */
  let fetchedAt = $state(cachedAt('/api/skills'))
  /** Ticking clock so a running rig's counter climbs in place (§13.5.1). */
  let now = $state(Date.now())

  const pct = (v: number) => `${Math.round(v * 100)}%`
  /** Like pct, but keeps the decimal for sub-1% passives (0.5%, not 1%). */
  const pctShort = (v: number) => {
    const n = v * 100
    return `${n < 1 && n > 0 ? n.toFixed(1) : Math.round(n)}%`
  }
  // the average profession level, so it also reads out of 100
  const totalLevel = $derived.by(() => {
    const skills = data?.skills ?? []
    if (!skills.length) return 1
    return Math.round(skills.reduce((n, s) => n + s.level, 0) / skills.length)
  })
  const pendingTalents = $derived(
    (data?.skills ?? []).filter(
      (s) => s.talent.pendingChoice || s.talent.mastery.pending.length > 0,
    ),
  )

  const groups = $derived(
    (['gathering', 'artisan', 'support', 'combat'] as SkillCategory[]).map((key) => ({
      key,
      ...CATEGORY[key],
      skills: (data?.skills ?? []).filter((s) => s.category === key),
    })),
  )

  /**
   * Professions with at least one rig running: the items they made since fetch,
   * the run closest to finishing, and its rate. Drives both the summary strip at
   * the top of the board and the live tell on each tile.
   */
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

  function runningRigs(d: SkillsResponse | null, fetchedAt: number, now: number): RunningRig[] {
    const out: RunningRig[] = []
    for (const s of d?.skills ?? []) {
      const rig = runningIn(s, fetchedAt, now)
      if (rig) out.push(rig)
    }
    return out.sort((a, b) => a.left - b.left)
  }

  /** One profession's running-rig tell, or undefined when nothing runs. */
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

  /** Items made across a profession's active rigs since the last fetch. */
  function gainedSince(actions: ActionDTO[], fetchedAt: number, now: number): number {
    let gained = 0
    for (const a of actions) {
      for (const n of Object.values(rigGainedSince(a.idle!, fetchedAt, now))) gained += n
    }
    return gained
  }

  const running = $derived(runningRigs(data, fetchedAt, now))

  /** The running tell for one profession, by id. */
  const runningById = $derived(new Map(running.map((r) => [r.id, r])))

  onMount(() => {
    void refresh()
    const timer = setInterval(() => (now = Date.now()), 250)
    return () => clearInterval(timer)
  })

  async function refresh() {
    try {
      const res = await getSkills()
      fetchedAt = Date.now()
      data = res
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  }
</script>

<div class="border-b border-ink-700 pt-4 pb-4">
  <div class="flex items-start justify-between gap-4">
    <h1 class="display min-w-0 text-3xl text-ink-100">Skills</h1>
    <div class="shrink-0 text-center">
      <div class="seal h-14 w-14" aria-label="Account level {totalLevel}">
        <span class="display text-xl leading-none font-bold">{totalLevel}</span>
      </div>
      <p class="seal__label" aria-hidden="true">Level</p>
    </div>
  </div>
  <p class="sub mt-2">Train a trade, gather materials, grow stronger.</p>
</div>

{#if error}
  <p class="banner mt-3" style={accentStyle(ACCENT.ember)} role="alert">{error}</p>
{/if}

{#if pendingTalents.length}
  <a
    href={href(`/skills/${pendingTalents[0]!.id}`)}
    class="mt-3 flex min-h-11 items-center gap-2 border-b border-ink-700 pb-3 text-sm"
    style={accentStyle(ACCENT.violet)}
  >
    <span class="h-2 w-2 shrink-0 rounded-[2px]" style="background: var(--accent)"></span>
    A talent is ready for
    <span class="min-w-0 truncate text-violet-300"
      >{pendingTalents.map((s) => s.name).join(', ')}</span
    >
    <span class="ml-auto shrink-0 text-ink-400" aria-hidden="true">→</span>
  </a>
{/if}

<a
  href={href('/combat')}
  class="mt-3 flex min-h-11 items-center gap-3 border-b border-ink-700 pb-3 text-sm"
  style={accentStyle(CATEGORY.combat.accent)}
>
  <Icon name="skull" size={18} />
  <span class="flex-1 text-ink-100">Combat — fight monsters for bones, hides and gems</span>
  <span class="text-ink-400" aria-hidden="true">→</span>
</a>

{#if running.length}
  <!-- The idle tell: which rigs are running and what they have made since (§13.5.1). -->
  <div class="mt-3 flex flex-wrap items-center gap-2 border-b border-ink-700 pb-3 text-xs">
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      width="12"
      height="12"
      class="inline-block shrink-0 text-ink-400"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
      />
    </svg>
    <span class="text-ink-400">Running</span>
    {#each running as r (r.id)}
      <a href={href(`/skills/${r.id}`)} class="chip" style={accentStyle(r.accent)}>
        {r.name}
        <span class="display tabular-nums">{r.gained}</span>
      </a>
    {/each}
  </div>
{/if}

{#if loading}
  <p class="banner mt-4" style={accentStyle(ACCENT.azure)}>
    <Spinner size={14} label="Loading skills" /> Loading…
  </p>
{:else}
  <div class="xl:columns-2 xl:gap-x-10">
    {#each groups as g (g.key)}
      {#if g.skills.length}
        <section class="mt-5 xl:break-inside-avoid">
          <div class="mb-2 flex items-center gap-2">
            <span class="h-2.5 w-2.5 rounded-[2px]" style="background: {g.accent}"></span>
            <h2 class="eyebrow" style="color: {g.accent}">{g.label}</h2>
            <span class="ml-auto text-xs text-ink-400">{g.skills.length}</span>
          </div>
          <ul class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
            {#each g.skills as s (s.id)}
              {@const pending = s.talent.pendingChoice || s.talent.mastery.pending.length > 0}
              {@const live = runningById.get(s.id)}
              <li style={accentStyle(g.accent)}>
                <a
                  href={href(`/skills/${s.id}`)}
                  class="panel panel-accent panel--press block p-2.5"
                  aria-label="{s.name}, level {s.level} of 100"
                >
                  <div class="flex items-center gap-2.5">
                    <span
                      class="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] border text-xl leading-none"
                      style="border-color: color-mix(in oklab, var(--accent) 45%, var(--color-ink-700)); background: color-mix(in oklab, var(--accent) 16%, var(--color-ink-950))"
                      aria-hidden="true">{s.icon}</span
                    >
                    <div class="min-w-0 flex-1">
                      <div class="flex items-baseline justify-between gap-1.5">
                        <span class="display truncate text-sm text-ink-100">{s.name}</span>
                        <span
                          class="display shrink-0 text-lg leading-none font-bold tabular-nums"
                          style="color: {g.accent}">{s.level}</span
                        >
                      </div>
                      <div class="bar mt-1.5 h-1.5"><i style="width: {s.progress * 100}%"></i></div>
                    </div>
                  </div>
                  <div class="mt-2 flex items-center gap-1.5 text-xs text-ink-400">
                    <span
                      class="min-w-0 truncate tabular-nums"
                      style="color: {g.accent}"
                      title={s.effectLabel}
                      >+{pctShort(s.effect.value)} {EFFECT_SHORT[s.effect.kind]}</span
                    >
                    {#if live}
                      <span
                        class="chip ml-auto shrink-0"
                        style={accentStyle(ACCENT.jade)}
                        title="{live.count} rig{live.count === 1
                          ? ''
                          : 's'} running · {live.rate} · {live.gained} made since you opened this page"
                      >
                        <span class="livedot"></span>
                        {live.gained > 0 ? `+${live.gained}` : live.rate}
                      </span>
                    {:else if pending}
                      <span class="chip ml-auto shrink-0" style={accentStyle(ACCENT.violet)}
                        >Talent</span
                      >
                    {/if}
                  </div>
                </a>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/each}
  </div>

  {#if data}
    <p class="mt-6 mb-6 text-center text-xs text-ink-400">
      Bonuses · global XP <span class="gold">+{pct(data.bonuses.globalXp)}</span> · power
      <span class="text-combat-400">+{pct(data.bonuses.damage)}</span> · drop
      <span class="text-support-400">+{pct(data.bonuses.drop)}</span>
    </p>
  {/if}
{/if}
