<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import {
    gradeExercise,
    gradeSpeak,
    nextExercise,
    setQuiet,
    studyMore,
    type Deck,
    type Grade,
    type Instance,
    type SrsOutcome,
    type Stats,
    type WordFeedback,
  } from '#lib/exercises'
  import type { SkillOutcome } from '#lib/skills'
  import { useSkills } from '#lib/skills/store.svelte'
  import { activeDeck, loadActiveDeck, setActiveDeck } from '#lib/activeDeck.svelte'
  import type { CurriculumDeck, LessonDTO, SrsStats } from '#lib/curriculum'
  import { href } from '#lib/paths'
  import { wakeSpeech } from '#lib/speech'
  import { ACCENT } from '#lib/theme'
  import Spinner from '#lib/components/Spinner.svelte'
  import PracticeHeader from '#lib/components/practice/PracticeHeader.svelte'
  import DoneTodayPanel from '#lib/components/practice/DoneTodayPanel.svelte'
  import SkillReward from '#lib/components/practice/SkillReward.svelte'
  import ResultActions from '#lib/components/practice/ResultActions.svelte'
  import ExerciseStage from '#lib/components/practice/ExerciseStage.svelte'
  import { nextLessonAfter, nextLessonTitleOf, quietClock } from '#lib/practiceview'
  import { answerBody, nextDrillBody, practiceLessonHref, speakForm } from '#lib/practiceview'
  import { cachedResource } from '#lib/resource.svelte'

  type GradeReply = Awaited<ReturnType<typeof gradeExercise>>

  const deckList = cachedResource<{ decks: Deck[] }>('/api/decks', { auto: false })
  const decks = $derived(deckList.data?.decks ?? [])
  const progress = cachedResource<Stats>('/api/stats', { auto: false })
  const stats = $derived(progress.data ?? null)
  let deckId = $state<string>('')
  let instance = $state<Instance | null>(null)
  let doneToday = $state(false)
  let result = $state<Grade | null>(null)
  let skill = $state<SkillOutcome | null>(null)
  let srs = $state<SrsOutcome | null>(null)
  let recorded = $state(false)
  let attempt = $state(0)
  let spoke = $state(false)
  const srsTotals = cachedResource<SrsStats>('/api/srs/stats', { auto: false })
  const srsStats = $derived(srsTotals.data ?? null)
  const board = useSkills()
  let lesson = $state<LessonDTO | null>(null)
  let lessonCompleted = $state(false)
  const path = cachedResource<{ decks: CurriculumDeck[] }>('/api/curriculum', { auto: false })
  let pathLost = $state(false)
  const curriculum = $derived(pathLost ? [] : (path.data?.decks ?? []))
  let nextLessonId = $state<string | undefined>(undefined)
  let loading = $state(true)
  let busy = $state(false)
  let advancing = $state(false)
  let error = $state('')
  let startedAt = $state(0)
  let speechWarm = $state<'idle' | 'warming' | 'ready' | 'error'>('idle')
  let quietUntil = $state(progress.data?.quietUntil ?? 0)
  let now = $state(Date.now())

  const actionId = $derived(page.url.searchParams.get('action') ?? undefined)
  const choiceId = $derived(page.url.searchParams.get('choice') ?? undefined)
  const deckParam = $derived(page.url.searchParams.get('deck') ?? undefined)
  let lessonId = $state<string | undefined>(page.url.searchParams.get('lesson') ?? undefined)
  const focused = $derived(Boolean(actionId || lessonId || deckParam))
  const needsSpeech = $derived(instance?.modality === 'voice' || instance?.modality === 'mixed')
  const quietActive = $derived(quietUntil > now)
  const quietLeft = $derived(quietClock(quietUntil, now))
  const skillMap = $derived(board.skillMap)
  const itemMap = $derived(board.itemMap)
  const actionName = $derived(
    actionId
      ? (board.skills.flatMap((s) => s.actions).find((a) => a.id === actionId)?.name ?? actionId)
      : null,
  )
  const skillName = $derived(
    actionId
      ? (board.skills.find((s) => s.actions.some((a) => a.id === actionId))?.name ?? '')
      : '',
  )
  const words = $derived((result?.detail?.words as WordFeedback[] | undefined) ?? [])
  const nextLessonTitle = $derived(nextLessonTitleOf(curriculum, nextLessonId))
  const canRetry = $derived(Boolean(instance && spoke && result && !result.correct))

  onMount(() => {
    void init()
  })

  async function init() {
    try {
      const [d, s] = await Promise.all([
        deckList.load(),
        progress.load(),
        board.refresh(),
        srsTotals.refresh(),
      ])
      await applyLoaded(d, s)
      if (lessonId) await loadLesson(lessonId)
      await loadNext()
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  }

  async function applyLoaded(d: { decks: Deck[] }, s: Stats) {
    await loadActiveDeck()
    deckId = deckParam ?? activeDeck.id ?? d.decks[0]?.id ?? ''
    quietUntil = s.quietUntil ?? 0
  }

  async function loadLesson(id: string) {
    pathLost = !(await path.refresh())
    applyLesson(id)
  }

  async function refreshSrs() {
    await srsTotals.refresh()
  }

  async function loadNext() {
    resetForNext()
    try {
      const r = await nextExercise(nextDrillBody({ actionId, choiceId, lessonId, deckId }))
      if (!r.instance || r.done) {
        doneToday = true
        void refreshSrs()
        return
      }
      instance = r.instance
      followLesson(r)
      startedAt = Date.now()
      if (r.instance.modality === 'voice' || r.instance.modality === 'mixed') void warmSpeech()
    } catch (e) {
      error = (e as Error).message
    }
  }

  function resetForNext() {
    error = ''
    result = null
    skill = null
    srs = null
    lessonCompleted = false
    instance = null
    doneToday = false
    speechWarm = 'idle'
    recorded = false
    attempt = 0
    spoke = false
  }

  function followLesson(r: Awaited<ReturnType<typeof nextExercise>>) {
    if (lessonId && r.lessonId && r.lessonId !== lessonId) {
      lessonId = r.lessonId
      applyLesson(lessonId)
    }
  }

  async function doStudyMore() {
    error = ''
    try {
      const r = await studyMore()
      if (srsStats) srsTotals.set({ ...srsStats, budget: r.budget })
      await loadNext()
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function warmSpeech() {
    speechWarm = 'warming'
    try {
      await wakeSpeech()
      speechWarm = 'ready'
    } catch {
      speechWarm = 'error'
    }
  }

  $effect(() => {
    if (!quietActive) return
    const timer = setInterval(() => (now = Date.now()), 1000)
    return () => clearInterval(timer)
  })

  async function applyQuiet(enabled: boolean) {
    error = ''
    try {
      const r = await setQuiet(enabled)
      quietUntil = r.quietUntil
      now = Date.now()
      if (!result) await loadNext()
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function submit(answer: unknown) {
    if (!instance) return
    const wasIntro = instance.exerciseId === 'introduce'
    busy = true
    error = ''
    spoke = false
    try {
      const r = await gradeExercise(
        answerBody({ instance, answer, startedAt, actionId, lessonId, choiceId }),
      )
      if (wasIntro) await finishIntro(r.stats)
      else applyResult(r)
    } catch (e) {
      error = (e as Error).message
    } finally {
      busy = false
      void refreshSrs()
    }
  }

  async function finishIntro(s: Stats) {
    applyStats(s)
    await loadNext()
  }

  function applyResult(r: GradeReply) {
    result = r.result
    skill = r.skill
    srs = r.srs ?? null
    lessonCompleted = Boolean(r.lessonCompleted)
    applyStats(r.stats)
  }

  function applyStats(s: Stats) {
    progress.set(s)
    quietUntil = s.quietUntil ?? quietUntil
  }

  async function submitAudio(blob: Blob) {
    if (!instance) return
    const isRetry = recorded
    busy = true
    error = ''
    spoke = true
    attempt += 1
    try {
      const r = await gradeSpeak(
        speakForm({ blob, isRetry, instance, startedAt, actionId, choiceId, lessonId }),
      )
      applyResult(r)
      if (!isRetry) recorded = !r.result.detail?.noSpeech
    } catch (e) {
      error = (e as Error).message
    } finally {
      busy = false
      void refreshSrs()
    }
  }

  function retry() {
    if (!instance) return
    result = null
    skill = null
    srs = null
    error = ''
    startedAt = Date.now()
  }

  function changeDeck(e: Event) {
    deckId = (e.target as HTMLSelectElement).value
    void setActiveDeck(deckId || null)
    void loadNext()
  }

  function applyLesson(id: string) {
    const all = curriculum.flatMap((d) => d.lessons)
    lesson = all.find((l) => l.id === id) ?? null
    nextLessonId = nextLessonAfter(curriculum, id)
  }

  async function nextStep() {
    if (advancing) return
    advancing = true
    try {
      if (!lessonCompleted) {
        await loadNext()
        return
      }
      await advanceLesson()
    } finally {
      advancing = false
    }
  }

  async function advanceLesson() {
    if (await path.refresh()) pathLost = false
    const id = nextLessonAfter(curriculum, lessonId ?? '')
    if (!id) {
      await goto(href('/learn'))
      return
    }
    lessonId = id
    applyLesson(id)
    await goto(practiceLessonHref(id, actionId), { replaceState: true })
    await loadNext()
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.repeat) return
    if (loading || busy || advancing) return
    const t = e.target instanceof HTMLElement ? e.target : null
    if (t?.closest('input, textarea, select, a') || t?.isContentEditable) return
    if (result) {
      e.preventDefault()
      void nextStep()
      return
    }
    const primary = document.querySelector<HTMLButtonElement>('[data-enter-action]:not(:disabled)')
    if (primary) {
      e.preventDefault()
      primary.click()
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="lg:mx-auto lg:max-w-2xl">
  <PracticeHeader
    {actionId}
    {skillName}
    {lesson}
    {actionName}
    {skill}
    {skillMap}
    {quietActive}
    {quietLeft}
    {stats}
    {srsStats}
    onQuiet={applyQuiet}
  />

  {#if !focused && decks.length > 1}
    <label class="mb-4 block">
      <span class="eyebrow mb-1.5 block text-ink-400">Deck</span>
      <select bind:value={deckId} onchange={changeDeck} class="field">
        {#each decks as d (d.id)}
          <option value={d.id}>{d.name} · {d.cardCount} cards</option>
        {/each}
      </select>
    </label>
  {:else if !focused && decks.length === 1}
    <p class="eyebrow mb-4 text-ink-400">{decks[0].name} · {decks[0].cardCount} cards</p>
  {/if}

  {#if loading}
    <p class="banner flex items-center gap-2" style="--accent: {ACCENT.azure}">
      <Spinner size={14} label="Loading practice" /> Loading…
    </p>
  {:else}
    {#if error}
      <p class="banner mb-3" style="--accent: {ACCENT.ember}" role="alert">{error}</p>
    {/if}
    {#if doneToday}
      <DoneTodayPanel {srsStats} onStudyMore={doStudyMore} />
    {:else if result}
      {#if lessonCompleted}
        <div class="panel panel-accent mb-3 p-4 text-center" style="--accent: {ACCENT.jade}">
          <p class="display text-lg text-jade-300">
            Lesson complete — {lesson?.title ?? 'nice work'}!
          </p>
          {#if !nextLessonId}
            <a href={href('/learn')} class="btn btn-primary mt-2">Back to Learn</a>
          {/if}
        </div>
      {/if}
      {#if skill}
        <SkillReward {skill} {skillMap} {actionName} {itemMap} />
      {/if}

      <ResultActions
        {result}
        {words}
        {srs}
        {canRetry}
        {attempt}
        {lessonCompleted}
        {nextLessonId}
        {nextLessonTitle}
        {advancing}
        onRetry={retry}
        onNext={nextStep}
      />
    {:else if instance}
      <ExerciseStage
        {instance}
        {busy}
        {needsSpeech}
        {speechWarm}
        onsubmit={submit}
        onspeak={submitAudio}
        onQuiet={applyQuiet}
      />
    {:else if error}
      <button onclick={loadNext} class="btn btn-ghost px-3 py-2 text-xs">Try again</button>
    {/if}
  {/if}
</div>
