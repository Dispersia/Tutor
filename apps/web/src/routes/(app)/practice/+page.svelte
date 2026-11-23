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

  // The header and deck picker seed from the last fetch, so entering Practice
  // shows them at once; the drill itself still comes from the server. `init`
  // loads them itself (`load()`), because a failure there must stop the drill.
  const deckList = cachedResource<{ decks: Deck[] }>('/api/decks', { auto: false })
  const decks = $derived(deckList.data?.decks ?? [])
  /** The header's progress: loaded by `init`, then replaced by every grade reply. */
  const progress = cachedResource<Stats>('/api/stats', { auto: false })
  const stats = $derived(progress.data ?? null)
  let deckId = $state<string>('')
  let instance = $state<Instance | null>(null)
  /** True when the day's new/review budget is spent and nothing can be served. */
  let doneToday = $state(false)
  let result = $state<Grade | null>(null)
  let skill = $state<SkillOutcome | null>(null)
  let srs = $state<SrsOutcome | null>(null)
  /**
   * True once a countable attempt for this card has been recorded. After a miss
   * on a speaking card the learner can re-record as often as they like; those
   * retries are graded but not counted, so SRS/XP only see the first attempt.
   */
  let recorded = $state(false)
  /** How many times the current card has been attempted (spoken answers). */
  let attempt = $state(0)
  /** True when the current result came from a recorded spoken answer. */
  let spoke = $state(false)
  /** Spaced-repetition totals (due / new), so the header can show what is left. */
  const srsTotals = cachedResource<SrsStats>('/api/srs/stats', { auto: false })
  const srsStats = $derived(srsTotals.data ?? null)
  /** The shared skills board: names for the action being trained and its rewards. */
  const board = useSkills()
  let lesson = $state<LessonDTO | null>(null)
  let lessonCompleted = $state(false)
  /** The full path, so we can find the lesson that follows the current one. */
  const path = cachedResource<{ decks: CurriculumDeck[] }>('/api/curriculum', { auto: false })
  /** Set when opening a lesson could not load the path: the header then shows none. */
  let pathLost = $state(false)
  const curriculum = $derived(pathLost ? [] : (path.data?.decks ?? []))
  /** The next unfinished lesson after the current one, if the path continues. */
  let nextLessonId = $state<string | undefined>(undefined)
  let loading = $state(true)
  let busy = $state(false)
  /** True while a "next" step is in flight, so Enter can't double-advance. */
  let advancing = $state(false)
  let error = $state('')
  let startedAt = $state(0)
  /** Speech-model warm-up state while a listen / speaking card is on screen (§8.1). */
  let speechWarm = $state<'idle' | 'warming' | 'ready' | 'error'>('idle')
  /** "Can't speak or listen right now": epoch ms when listen/speak cards return. */
  let quietUntil = $state(progress.data?.quietUntil ?? 0)
  /** Ticking clock so the quiet countdown and expiry update live. */
  let now = $state(Date.now())

  const actionId = $derived(page.url.searchParams.get('action') ?? undefined)
  /** The recipe choice for a choose-input action (prospect/cut), from the URL. */
  const choiceId = $derived(page.url.searchParams.get('choice') ?? undefined)
  const deckParam = $derived(page.url.searchParams.get('deck') ?? undefined)
  /** The lesson being drilled; starts from the URL and advances as one finishes. */
  let lessonId = $state<string | undefined>(page.url.searchParams.get('lesson') ?? undefined)
  const focused = $derived(Boolean(actionId || lessonId || deckParam))
  /** A listen / speaking card needs the local speech models (TTS/ASR) up. */
  const needsSpeech = $derived(instance?.modality === 'voice' || instance?.modality === 'mixed')
  /** True while the "can't speak or listen" option is on. */
  const quietActive = $derived(quietUntil > now)
  /** mm:ss remaining in the quiet window. */
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
  /** A spoken answer that missed: offer a re-record loop until it lands. */
  const canRetry = $derived(Boolean(instance && spoke && result && !result.correct))

  onMount(() => {
    void init()
  })

  async function init() {
    try {
      // `load()` rejects, so a failed deck list or progress stops here and no
      // card is requested. The board and the totals are a bonus (`refresh()`
      // never rejects): they report into their own stores.
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
    // Free practice opens on the deck chosen everywhere (the profile menu);
    // an explicit `?deck=` link still wins for that visit.
    await loadActiveDeck()
    deckId = deckParam ?? activeDeck.id ?? d.decks[0]?.id ?? ''
    quietUntil = s.quietUntil ?? 0
  }

  /** Loads the path and points the header at a lesson id (none when it fails). */
  async function loadLesson(id: string) {
    pathLost = !(await path.refresh())
    applyLesson(id)
  }

  /** Re-reads the spaced-repetition totals (called after every graded answer). */
  async function refreshSrs() {
    await srsTotals.refresh()
  }

  async function loadNext() {
    resetForNext()
    try {
      const r = await nextExercise(nextDrillBody({ actionId, choiceId, lessonId, deckId }))
      if (!r.instance || r.done) {
        // Daily budget spent: show the goal instead of a drill.
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

  /** Clears the previous card's state before a fresh drill. */
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

  /**
   * A one-word step has nothing else to drill while its learning step waits, so
   * the queue moves on to the path's next word: follow the card that is actually
   * on screen instead of pinning the header to the first.
   */
  function followLesson(r: Awaited<ReturnType<typeof nextExercise>>) {
    if (lessonId && r.lessonId && r.lessonId !== lessonId) {
      lessonId = r.lessonId
      applyLesson(lessonId)
    }
  }

  /** Raise today's allowance (Anki's "study more") and continue drilling. */
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

  /**
   * Pre-warm the local speech gateway when a listen / speaking card opens, so
   * the first play/record skips the model-load latency (DESIGN §8.1).
   */
  async function warmSpeech() {
    speechWarm = 'warming'
    try {
      await wakeSpeech()
      speechWarm = 'ready'
    } catch {
      speechWarm = 'error'
    }
  }

  // Keep the quiet countdown (and its expiry) live while the window is on.
  $effect(() => {
    if (!quietActive) return
    const timer = setInterval(() => (now = Date.now()), 1000)
    return () => clearInterval(timer)
  })

  /** Turns the "can't speak or listen right now" option on (15 min) or off. */
  async function applyQuiet(enabled: boolean) {
    error = ''
    try {
      const r = await setQuiet(enabled)
      quietUntil = r.quietUntil
      now = Date.now()
      // A listen/speak card may be on screen: swap it out (or back in) at once.
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

  // A first-exposure teach step has no result screen: it records that the card
  // was introduced, then moves straight to the drill for that word.
  async function finishIntro(s: Stats) {
    applyStats(s)
    await loadNext()
  }

  /** Applies a graded reply: result, rewards, lesson flag and stats. */
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
      // A silent clip is not a countable attempt: the next try is still the
      // first one, so it records as usual.
      if (!isRetry) recorded = !r.result.detail?.noSpeech
    } catch (e) {
      error = (e as Error).message
    } finally {
      busy = false
      void refreshSrs()
    }
  }

  /**
   * Re-record the same speaking card after a miss, without leaving the card or
   * pulling a new one. The retry is graded like the first attempt (so the score
   * and tips update) but the server keeps it out of the SRS schedule.
   */
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
    // Picking a deck here is picking it everywhere: keep the profile choice in sync.
    void setActiveDeck(deckId || null)
    void loadNext()
  }

  /** Points the header and the "next lesson" target at a lesson id. */
  function applyLesson(id: string) {
    const all = curriculum.flatMap((d) => d.lessons)
    lesson = all.find((l) => l.id === id) ?? null
    nextLessonId = nextLessonAfter(curriculum, id)
  }

  /**
   * "Next" after a result: within a lesson, fetch the next drill; once the
   * lesson is complete, continue on the next lesson of the path instead of
   * re-drilling the one that just finished.
   */
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

  /** After a finished lesson: refresh the path and continue on the next lesson. */
  async function advanceLesson() {
    // A failed refresh keeps the path already shown.
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

  /**
   * Enter should always do the obvious thing for the screen at hand:
   *
   * - On a result screen it carries forward like the "Next" button.
   * - On an exercise it fires the single primary button (the "Got it" of a new
   *   word, "Check" when the answer is built from tiles) — anything marked
   *   `data-enter-action`.
   *
   * Typing fields keep Enter for themselves (a form submits, a textarea gets a
   * newline) and links follow normally. A focused choice or button activates
   * natively when there is no primary action on screen.
   */
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
    <!-- An error sits above the stage: the card (and a typed answer) stays put. -->
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
