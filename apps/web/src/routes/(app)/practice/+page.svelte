<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import { componentFor } from '#lib/components/exercises'
  import {
    gradeExercise,
    gradeSpeak,
    getStats,
    listDecks,
    nextExercise,
    type Deck,
    type Grade,
    type Instance,
    type Stats,
    type WordFeedback,
  } from '#lib/exercises'
  import { getSkills, type SkillOutcome, type SkillsResponse } from '#lib/skills'
  import { getCurriculum, type LessonDTO } from '#lib/curriculum'
  import { href } from '#lib/paths'

  let decks = $state<Deck[]>([])
  let deckId = $state<string>('')
  let instance = $state<Instance | null>(null)
  let result = $state<Grade | null>(null)
  let skill = $state<SkillOutcome | null>(null)
  let stats = $state<Stats | null>(null)
  let ref = $state<SkillsResponse | null>(null)
  let lesson = $state<LessonDTO | null>(null)
  let lessonCompleted = $state(false)
  let loading = $state(true)
  let busy = $state(false)
  let error = $state('')
  let startedAt = $state(0)

  const actionId = $derived(page.url.searchParams.get('action') ?? undefined)
  const lessonId = $derived(page.url.searchParams.get('lesson') ?? undefined)
  const deckParam = $derived(page.url.searchParams.get('deck') ?? undefined)
  const focused = $derived(Boolean(actionId || lessonId || deckParam))
  const skillMap = $derived(new Map((ref?.skills ?? []).map((s) => [s.id, s])))
  const itemMap = $derived(new Map((ref?.items ?? []).map((i) => [i.id, i])))
  const actionName = $derived(
    actionId
      ? (ref?.skills.flatMap((s) => s.actions).find((a) => a.id === actionId)?.name ?? actionId)
      : null,
  )
  const skillName = $derived(
    actionId ? (ref?.skills.find((s) => s.actions.some((a) => a.id === actionId))?.name ?? '') : '',
  )
  const words = $derived((result?.detail?.words as WordFeedback[] | undefined) ?? [])

  onMount(async () => {
    try {
      const [d, s, sk] = await Promise.all([listDecks(), getStats(), getSkills().catch(() => null)])
      decks = d.decks
      deckId = deckParam ?? decks[0]?.id ?? ''
      stats = s
      ref = sk
      if (lessonId) {
        const c = await getCurriculum().catch(() => null)
        lesson = c?.decks.flatMap((x) => x.lessons).find((l) => l.id === lessonId) ?? null
      }
      await loadNext()
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  })

  async function loadNext() {
    error = ''
    result = null
    skill = null
    lessonCompleted = false
    instance = null
    try {
      const body = actionId ? { actionId } : lessonId ? { lessonId } : deckId ? { deckId } : {}
      const r = await nextExercise(body)
      instance = r.instance
      startedAt = Date.now()
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function submit(answer: unknown) {
    if (!instance) return
    busy = true
    error = ''
    try {
      const r = await gradeExercise({
        exerciseId: instance.exerciseId,
        cardId: instance.cardId,
        answer,
        latencyMs: Date.now() - startedAt,
        actionId,
        lessonId,
      })
      result = r.result
      skill = r.skill
      lessonCompleted = Boolean(r.lessonCompleted)
      stats = r.stats
    } catch (e) {
      error = (e as Error).message
    } finally {
      busy = false
    }
  }

  async function submitAudio(blob: Blob) {
    if (!instance) return
    busy = true
    error = ''
    try {
      const form = new FormData()
      form.set('file', blob, 'clip.webm')
      form.set('cardId', instance.cardId)
      form.set('exerciseId', instance.exerciseId)
      form.set('latencyMs', String(Date.now() - startedAt))
      if (actionId) form.set('actionId', actionId)
      if (lessonId) form.set('lessonId', lessonId)
      const r = await gradeSpeak(form)
      result = r.result
      skill = r.skill
      lessonCompleted = Boolean(r.lessonCompleted)
      stats = r.stats
    } catch (e) {
      error = (e as Error).message
    } finally {
      busy = false
    }
  }

  function changeDeck(e: Event) {
    deckId = (e.target as HTMLSelectElement).value
    void loadNext()
  }
</script>

<div class="flex items-center justify-between pt-4 pb-3">
  <div>
    <h1 class="text-lg font-semibold">
      {actionId ? skillName : lesson ? lesson.title : 'Practice'}
    </h1>
    <p class="text-xs text-neutral-500">
      {actionId
        ? actionName
        : lesson
          ? `${lesson.level.toUpperCase()} · ${lesson.learned}/${lesson.cards} learned`
          : 'Free practice — spaced repetition picks what’s due'}
    </p>
  </div>
  <div class="flex items-center gap-2 text-xs">
    {#if skillMap.get(skill?.skillId ?? '')}
      <span class="rounded-full bg-neutral-800 px-2 py-1">
        {skillMap.get(skill!.skillId)!.icon}
        {skillMap.get(skill!.skillId)!.name}
        {skill!.level ?? ''}
      </span>
    {/if}
    <span class="rounded-full bg-emerald-900/60 px-2 py-1 text-emerald-300">
      {stats?.xp ?? 0} XP
    </span>
  </div>
</div>

{#if !focused}
  <select
    value={deckId}
    onchange={changeDeck}
    class="mb-4 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
  >
    {#each decks as d (d.id)}
      <option value={d.id}>{d.name} · {d.cardCount} cards</option>
    {/each}
  </select>
{/if}

{#if loading}
  <p class="text-sm text-neutral-500">Loading…</p>
{:else if error}
  <p class="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>
  <button onclick={loadNext} class="mt-3 rounded-xl border border-neutral-700 px-3 py-2 text-sm"
    >Back</button
  >
{:else if result}
  {#if lessonCompleted}
    <div class="mb-3 rounded-2xl border border-emerald-700 bg-emerald-950/40 p-4 text-center">
      <p class="text-lg font-medium">🎉 Lesson complete — {lesson?.title ?? 'nice work'}!</p>
      <a
        href={href('/learn')}
        class="mt-2 inline-block rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-black"
        >Back to Learn</a
      >
    </div>
  {/if}
  {#if skill}
    <div class="mb-3 flex flex-wrap gap-2 text-xs">
      <span class="rounded-lg bg-sky-900/40 px-2 py-1 text-sky-200">
        {skillMap.get(skill.skillId)?.icon ?? ''}
        {skillMap.get(skill.skillId)?.name ?? skill.skillId}
        +{skill.xp} xp
        {#if skill.leveledUp}· level {skill.level}!{/if}
      </span>
      {#each skill.gained as g (g.item)}
        <span class="rounded-lg bg-emerald-900/40 px-2 py-1 text-emerald-200">
          +{g.count}
          {itemMap.get(g.item)?.icon ?? ''}
          {itemMap.get(g.item)?.name ?? g.item}
        </span>
      {/each}
      {#each skill.grantedTalents as t (t.id)}
        <span class="rounded-lg bg-amber-900/40 px-2 py-1 text-amber-200">🏅 {t.name}</span>
      {/each}
    </div>
  {/if}

  <div
    class="rounded-2xl border p-5 {result.correct
      ? 'border-emerald-800 bg-emerald-950/40'
      : 'border-amber-800 bg-amber-950/30'}"
  >
    <div class="flex items-baseline justify-between">
      <span class="text-lg font-medium">{result.correct ? '✓ Correct' : '✗ Not quite'}</span>
      <span class="text-sm text-neutral-300">{result.score}/100</span>
    </div>
    {#if result.expected}
      <p class="mt-2 text-sm text-neutral-300">
        Answer: <span class="text-lg">{result.expected}</span>
      </p>
    {/if}
    {#if result.feedback}
      <p class="mt-1 text-sm text-neutral-400">{result.feedback}</p>
    {/if}
    {#if words.length}
      <div class="mt-3 flex flex-wrap gap-2">
        {#each words as w (w.text)}
          <span
            class="rounded-lg px-2 py-1 text-sm {w.ok
              ? 'bg-emerald-900/50 text-emerald-200'
              : 'bg-red-900/50 text-red-200'}"
          >
            {w.text}{w.tip ? ` · ${w.tip}` : ''}
          </span>
        {/each}
      </div>
    {/if}
  </div>
  <button
    onclick={loadNext}
    class="mt-4 w-full rounded-xl bg-emerald-500 py-3 font-medium text-black">Next →</button
  >
{:else if instance}
  {@const Comp = componentFor(instance.exerciseId)}
  <div class="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
    <Comp {instance} {busy} onsubmit={submit} onspeak={submitAudio} />
  </div>
{/if}
