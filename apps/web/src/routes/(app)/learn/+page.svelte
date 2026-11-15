<script lang="ts">
  import { onMount } from 'svelte'
  import { href } from '#lib/paths'
  import { getCurriculum, getSrsStats, type CurriculumDeck, type SrsStats } from '#lib/curriculum'
  import { getSkills, type SkillsResponse } from '#lib/skills'
  import { session } from '#lib/session.svelte'
  import { ACCENT, accentStyle } from '#lib/theme'
  import Spinner from '#lib/components/Spinner.svelte'

  let decks = $state<CurriculumDeck[]>([])
  let stats = $state<SrsStats | null>(null)
  let ref = $state<SkillsResponse | null>(null)
  let actionId = $state('')
  let loading = $state(true)
  let error = $state('')

  const storageKey = $derived(`tutor.profession.${session.user?.id ?? 'anon'}`)

  /** Actions you can actually train: unlocked and with materials in the bank. */
  const usable = $derived(
    (ref?.skills ?? []).flatMap((skill) =>
      skill.actions
        .filter((action) => action.unlocked && action.affordable)
        .map((action) => ({ skill, action })),
    ),
  )
  const selected = $derived(usable.find((u) => u.action.id === actionId))

  /** The same actions grouped by profession, for the selector. */
  const groups = $derived(
    (ref?.skills ?? [])
      .map((skill) => ({
        skill,
        actions: skill.actions.filter((action) => action.unlocked && action.affordable),
      }))
      .filter((group) => group.actions.length > 0),
  )

  onMount(async () => {
    try {
      const [c, s, sk] = await Promise.all([
        getCurriculum(),
        getSrsStats(),
        getSkills().catch(() => null),
      ])
      // the frequency path first — that is where you start
      decks = c.decks.sort((a, b) => rank(a.level) - rank(b.level))
      stats = s
      ref = sk
      const saved = localStorage.getItem(storageKey)
      if (saved && usable.some((u) => u.action.id === saved)) actionId = saved
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  })

  function chooseProfession(e: Event) {
    actionId = (e.target as HTMLSelectElement).value
    if (actionId) localStorage.setItem(storageKey, actionId)
    else localStorage.removeItem(storageKey)
  }

  /** A practice URL that carries the selected profession action. */
  function practiceHref(params: { lesson?: string; deck?: string }): string {
    const query = new URLSearchParams()
    if (params.lesson) query.set('lesson', params.lesson)
    if (params.deck) query.set('deck', params.deck)
    if (actionId) query.set('action', actionId)
    return href(`/practice?${query.toString()}`)
  }

  const rank = (level: string) => (level === 'zhfreq' ? 0 : level === 'jafreq' ? 1 : 2)

  const deckAccent = (level: string) =>
    level === 'zhfreq' ? ACCENT.green : level === 'jafreq' ? ACCENT.level : ACCENT.arcane

  /** The next step of the path: the first lesson not yet finished. */
  const nextLesson = (d: CurriculumDeck) =>
    d.lessons.find((l) => !l.complete) ?? d.lessons[d.lessons.length - 1]

  const done = (d: CurriculumDeck) => d.cardCount > 0 && d.learned >= d.cardCount
</script>

<div class="flex items-center justify-between border-b border-ink-700 pt-5 pb-4">
  <div>
    <h1 class="display text-3xl text-ink-100">Learn</h1>
    <p class="mt-1 text-xs text-ink-400">One new word at a time — tap next and go.</p>
  </div>
  {#if stats}
    <div class="text-right">
      <div class="display text-2xl {stats.due > 0 ? 'text-brass-300' : 'text-ink-100'}">
        {stats.due}
      </div>
      <div class="eyebrow">due · {stats.learned}/{stats.total} learned</div>
    </div>
  {/if}
</div>

{#if error}
  <p class="mb-3 rounded-md bg-ember-950 px-3 py-2 text-sm text-ember-300">{error}</p>
{/if}

{#if loading}
  <p class="flex items-center gap-2 text-sm text-ink-400">
    <Spinner size={14} label="Loading your path" /> Loading…
  </p>
{:else if decks.length === 0}
  <p class="text-sm text-ink-400">No courses yet.</p>
{:else}
  <section class="panel mb-4 p-4" style="--accent: {ACCENT.arcane}">
    <div class="flex items-baseline justify-between">
      <p class="eyebrow">Profession</p>
      {#if selected}
        <span class="chip" style="--accent: {ACCENT.arcane}">
          {selected.skill.icon}
          {selected.skill.name}
        </span>
      {/if}
    </div>
    {#if groups.length === 0}
      <p class="mt-2 text-sm text-ink-400">
        No profession is ready to train.
        <a href={href('/skills')} class="gold">Unlock one in Skills</a>.
      </p>
    {:else}
      <select
        value={actionId}
        onchange={chooseProfession}
        class="mt-2 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm"
      >
        <option value="">Choose a profession…</option>
        {#each groups as group (group.skill.id)}
          <optgroup label="{group.skill.icon} {group.skill.name}">
            {#each group.actions as action (action.id)}
              <option value={action.id}>{action.name}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
      {#if selected}
        <p class="mt-2 text-xs text-ink-400">{selected.action.description}</p>
      {:else}
        <p class="mt-2 text-xs text-brass-300">
          Pick a profession first — lessons train that profession.
        </p>
      {/if}
    {/if}
  </section>

  {#each decks as d (d.deckId)}
    {@const acc = deckAccent(d.level ?? '')}
    {@const next = nextLesson(d)}
    {@const progress = d.cardCount > 0 ? (d.learned / d.cardCount) * 100 : 0}
    <section class="panel panel-accent mb-5 p-4" style={accentStyle(acc)}>
      <div class="flex items-baseline justify-between">
        <h2 class="display text-lg" style="color: {acc}">{d.name}</h2>
        <span class="text-xs text-ink-400">{d.learned}/{d.cardCount} learned</span>
      </div>
      <div class="bar mt-2">
        <i style="width: {progress}%"></i>
      </div>

      {#if next}
        {#if actionId}
          <a href={practiceHref({ lesson: next.id })} class="btn btn-primary mt-3 w-full py-3">
            {d.learned > 0 ? 'Next' : 'Start'} · {next.newWord ?? next.title}
            {#if next.reading && next.reading !== next.newWord}
              <span class="ml-1 text-xs opacity-75">{next.reading}</span>
            {/if}
          </a>
        {:else}
          <button disabled class="btn btn-ghost mt-3 w-full py-3">
            Select a profession to start
          </button>
        {/if}
        {#if next.newWord}
          <p class="mt-1.5 text-center text-xs text-ink-400">new word · {next.description}</p>
        {:else if next.description}
          <p class="mt-1.5 text-center text-xs text-ink-400">{next.description}</p>
        {/if}
        {#if next.cards > 1}
          <p class="mt-1.5 text-center text-[11px] text-ink-500">
            {next.learned}/{next.cards} in this lesson
          </p>
        {/if}
      {:else}
        <p class="mt-3 text-center text-sm text-ink-400">Course complete</p>
      {/if}

      {#if d.due > 0}
        {#if actionId}
          <a href={practiceHref({ deck: d.deckId })} class="btn btn-ghost mt-2 w-full">
            Review {d.due} due
          </a>
        {:else}
          <button disabled class="btn btn-ghost mt-2 w-full">
            Select a profession to review
          </button>
        {/if}
      {/if}

      {#if done(d)}
        <p class="mt-2 text-center text-[11px] text-jade-400">All words learned ✓</p>
      {/if}
    </section>
  {/each}
{/if}
<div class="h-4"></div>
