<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { componentFor } from '#lib/components/exercises'
  import {
    gradeExercise,
    gradeSpeak,
    getStats,
    listDecks,
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
  import { getSkills, type SkillOutcome, type SkillsResponse } from '#lib/skills'
  import { activeDeck, loadActiveDeck, setActiveDeck } from '#lib/activeDeck.svelte'
  import { fmtClock, fmtInterval } from '#lib/idle'
  import {
    getCurriculum,
    getSrsStats,
    type CurriculumDeck,
    type LessonDTO,
    type SrsStats,
  } from '#lib/curriculum'
  import { href } from '#lib/paths'
  import { wakeSpeech } from '#lib/speech'
  import { ACCENT, categoryAccent } from '#lib/theme'
  import Icon from '#lib/components/Icon.svelte'
  import Spinner from '#lib/components/Spinner.svelte'
  import { peekCached } from '#lib/cache'

  // Seed the header and deck picker from the last fetch, so entering Practice
  // shows them at once; the drill itself still comes from the server.
  const cachedDecks = peekCached<{ decks: Deck[] }>('/api/decks')
  const cachedStats = peekCached<Stats>('/api/stats')
  const cachedSrs = peekCached<SrsStats>('/api/srs/stats')
  const cachedSkills = peekCached<SkillsResponse>('/api/skills')
  const cachedCurriculum = peekCached<{ decks: CurriculumDeck[] }>('/api/curriculum')
  let decks = $state<Deck[]>(cachedDecks?.decks ?? [])
  let deckId = $state<string>('')
  let instance = $state<Instance | null>(null)
  /** True when the day's new/review budget is spent and nothing can be served. */
  let doneToday = $state(false)
  let result = $state<Grade | null>(null)
  let skill = $state<SkillOutcome | null>(null)
  let srs = $state<SrsOutcome | null>(null)
  let stats = $state<Stats | null>(cachedStats ?? null)
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
  let srsStats = $state<SrsStats | null>(cachedSrs ?? null)
  let ref = $state<SkillsResponse | null>(cachedSkills ?? null)
  let lesson = $state<LessonDTO | null>(null)
  let lessonCompleted = $state(false)
  /** The full path, so we can find the lesson that follows the current one. */
  let curriculum = $state<CurriculumDeck[]>(cachedCurriculum?.decks ?? [])
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
  let quietUntil = $state(cachedStats?.quietUntil ?? 0)
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
  const quietClock = $derived.by(() => {
    const s = Math.max(0, Math.ceil((quietUntil - now) / 1000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  })
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
  const nextLessonTitle = $derived.by(() => {
    const next = curriculum.flatMap((d) => d.lessons).find((l) => l.id === nextLessonId)
    return next?.newWord ?? next?.title ?? ''
  })
  /** A spoken answer that missed: offer a re-record loop until it lands. */
  const canRetry = $derived(Boolean(instance && spoke && result && !result.correct))

  onMount(async () => {
    try {
      const [d, s, sk, srs] = await Promise.all([
        listDecks(),
        getStats(),
        getSkills().catch(() => null),
        getSrsStats().catch(() => null),
      ])
      decks = d.decks
      // Free practice opens on the deck chosen everywhere (the profile menu);
      // an explicit `?deck=` link still wins for that visit.
      await loadActiveDeck()
      deckId = deckParam ?? activeDeck.id ?? decks[0]?.id ?? ''
      stats = s
      srsStats = srs
      quietUntil = s.quietUntil ?? 0
      ref = sk
      if (lessonId) {
        const c = await getCurriculum().catch(() => null)
        curriculum = c?.decks ?? []
        applyLesson(lessonId)
      }
      await loadNext()
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  })

  /** Re-reads the spaced-repetition totals (called after every graded answer). */
  async function refreshSrs() {
    srsStats = await getSrsStats().catch(() => srsStats)
  }

  async function loadNext() {
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
    try {
      const body: { actionId?: string; lessonId?: string; deckId?: string; choiceId?: string } = {}
      if (actionId) body.actionId = actionId
      if (actionId && choiceId) body.choiceId = choiceId
      if (lessonId) body.lessonId = lessonId
      if (!actionId && !lessonId && deckId) body.deckId = deckId
      const r = await nextExercise(body)
      if (!r.instance || r.done) {
        // Daily budget spent: show the goal instead of a drill.
        doneToday = true
        void refreshSrs()
        return
      }
      instance = r.instance
      // A one-word step has nothing else to drill while its learning step
      // waits, so the queue moves on to the path's next word: follow the card
      // that is actually on screen instead of pinning the header to the first.
      if (lessonId && r.lessonId && r.lessonId !== lessonId) {
        lessonId = r.lessonId
        applyLesson(lessonId)
      }
      startedAt = Date.now()
      if (r.instance.modality === 'voice' || r.instance.modality === 'mixed') void warmSpeech()
    } catch (e) {
      error = (e as Error).message
    }
  }

  /** Raise today's allowance (Anki's "study more") and continue drilling. */
  async function doStudyMore() {
    error = ''
    try {
      const r = await studyMore()
      if (srsStats) srsStats = { ...srsStats, budget: r.budget }
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
      const r = await gradeExercise({
        exerciseId: instance.exerciseId,
        cardId: instance.cardId,
        answer,
        latencyMs: Date.now() - startedAt,
        actionId,
        lessonId,
        choiceId,
      })
      // A first-exposure teach step has no result screen: it records that the
      // card was introduced, then moves straight to the drill for that word.
      if (wasIntro) {
        stats = r.stats
        quietUntil = r.stats.quietUntil ?? quietUntil
        await loadNext()
        return
      }
      result = r.result
      skill = r.skill
      srs = r.srs ?? null
      lessonCompleted = Boolean(r.lessonCompleted)
      stats = r.stats
      quietUntil = r.stats.quietUntil ?? quietUntil
    } catch (e) {
      error = (e as Error).message
    } finally {
      busy = false
      void refreshSrs()
    }
  }

  async function submitAudio(blob: Blob) {
    if (!instance) return
    const isRetry = recorded
    busy = true
    error = ''
    spoke = true
    attempt += 1
    try {
      const form = new FormData()
      form.set('file', blob, 'clip.webm')
      form.set('cardId', instance.cardId)
      form.set('exerciseId', instance.exerciseId)
      form.set('latencyMs', String(Date.now() - startedAt))
      if (isRetry) form.set('retry', 'true')
      if (actionId) form.set('actionId', actionId)
      if (choiceId) form.set('choiceId', choiceId)
      if (lessonId) form.set('lessonId', lessonId)
      const r = await gradeSpeak(form)
      result = r.result
      skill = r.skill
      srs = r.srs ?? null
      lessonCompleted = Boolean(r.lessonCompleted)
      stats = r.stats
      quietUntil = r.stats.quietUntil ?? quietUntil
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
    nextLessonId = nextLessonAfter(id)
  }

  /** The next step of the path: the first unfinished lesson after this one. */
  function nextLessonAfter(id: string): string | undefined {
    const deck = curriculum.find((d) => d.lessons.some((l) => l.id === id))
    if (!deck) return undefined
    const idx = deck.lessons.findIndex((l) => l.id === id)
    if (idx < 0) return undefined
    return deck.lessons.slice(idx + 1).find((l) => !l.complete)?.id
  }

  /** A practice URL for a lesson that keeps the selected profession action. */
  function lessonHref(id: string): string {
    const query = new URLSearchParams({ lesson: id })
    if (actionId) query.set('action', actionId)
    return href(`/practice?${query.toString()}`)
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
      // refresh the path so the lesson just finished counts as done
      const c = await getCurriculum().catch(() => null)
      if (c) curriculum = c.decks
      const id = nextLessonAfter(lessonId ?? '')
      if (!id) {
        await goto(href('/learn'))
        return
      }
      lessonId = id
      applyLesson(id)
      await goto(lessonHref(id), { replaceState: true })
      await loadNext()
    } finally {
      advancing = false
    }
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

  const RATING_NAMES = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' } as const

  /** Short label for the lesson header (the frequency path reads as "Frequency"). */
  function lessonLabel(l: LessonDTO): string {
    if (l.level === 'zhfreq' || l.level === 'jafreq') return 'Frequency'
    // generated decks address their lessons by deck id; show a plain label
    return l.level.length > 12 ? 'Deck' : l.level.toUpperCase()
  }

  /** Human summary of the FSRS-6 scheduling decision. */
  function reviewLabel(s: SrsOutcome): string {
    const rating = RATING_NAMES[s.rating]
    if (s.state === 'learning' || s.state === 'relearning') {
      const mins = Math.max(1, Math.round((s.dueAt - Date.now()) / 60_000))
      return `${rating} · again in ${mins} min`
    }
    const d = s.intervalDays
    return `${rating} · next in ${d} day${d === 1 ? '' : 's'}`
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="lg:mx-auto lg:max-w-2xl">
  <div
    class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-ink-700 pt-4 pb-4 mb-4"
  >
    <div class="min-w-0">
      <h1 class="display text-3xl text-ink-100">
        {actionId ? skillName : lesson ? lesson.title : 'Free practice'}
      </h1>
      <p class="sub mt-2">
        {actionId
          ? actionName
          : lesson
            ? `${lessonLabel(lesson)} · ${lesson.learned}/${lesson.cards} learned`
            : 'Spaced repetition picks what’s due'}
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-2 text-xs">
      {#if skillMap.get(skill?.skillId ?? '')}
        <span class="chip" style="--accent: {ACCENT.violet}">
          {skillMap.get(skill!.skillId)!.icon}
          {skillMap.get(skill!.skillId)!.name}
          {skill!.level ?? ''}
        </span>
      {/if}
      <button
        type="button"
        onclick={() => applyQuiet(!quietActive)}
        class="chip chip--press gap-1"
        style="--accent: {quietActive ? ACCENT.brass : ACCENT.azure}"
        title={quietActive
          ? 'Listen & speak cards return when this ends — turn it off now'
          : 'Hide listen & speak cards for 15 min'}
        aria-pressed={quietActive}
      >
        <Icon name="mute" size={12} />
        {quietActive ? quietClock : 'Can’t speak?'}
      </button>
      <span
        class="chip"
        style="--accent: {ACCENT.gold}"
        title="Study XP from graded cards and won fights — fills your daily goal"
      >
        {stats?.xp ?? 0} XP
      </span>
      {#if srsStats}
        <span
          class="chip"
          style="--accent: {srsStats.due > 0 ? ACCENT.azure : ACCENT.jade}"
          title="Cards due for review across your decks"
        >
          {srsStats.due} due
        </span>
        {#if srsStats.budget && !srsStats.budget.newUnlimited}
          <span
            class="chip"
            style="--accent: {srsStats.budget.newRemaining > 0 ? ACCENT.violet : ACCENT.jade}"
            title="New cards left in today's budget"
          >
            {srsStats.budget.newRemaining} new
          </span>
        {/if}
      {/if}
    </div>
  </div>

  {#if quietActive}
    <div class="panel panel-accent mb-4 p-3 text-xs" style="--accent: {ACCENT.brass}">
      <span class="text-brass-300">Text-only mode</span>
      — listen &amp; speak cards are hidden for
      <span class="gold">{quietClock}</span>.
      <button type="button" onclick={() => applyQuiet(false)} class="cursor-pointer underline"
        >Turn off</button
      >
    </div>
  {/if}

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
  {:else if error}
    <p class="banner" style="--accent: {ACCENT.ember}" role="alert">{error}</p>
    <button onclick={loadNext} class="btn btn-ghost mt-3 px-3 py-2 text-xs">Back</button>
  {:else if doneToday}
    <div class="panel panel-accent p-5 text-center" style="--accent: {ACCENT.jade}">
      <p class="display text-lg text-jade-300">That’s everything for now</p>
      <p class="mt-2 text-sm text-ink-300">
        {#if srsStats?.budget}
          {#if !srsStats.budget.newUnlimited}
            {srsStats.budget.newToday}/{srsStats.budget.newPerDay} new
          {/if}
          {#if !srsStats.budget.newUnlimited && !srsStats.budget.reviewsUnlimited}·{/if}
          {#if !srsStats.budget.reviewsUnlimited}
            {srsStats.budget.reviewsToday}/{srsStats.budget.maxReviewsPerDay} reviews
          {/if}
        {/if}
      </p>
      <p class="mt-1 text-xs text-ink-400">
        Nothing is due and no new words are left in this deck.
      </p>
      <div class="mt-4 flex flex-col gap-2">
        <button onclick={doStudyMore} class="btn btn-primary w-full py-3">Study more</button>
        <a href={href('/learn')} class="btn btn-ghost w-full py-3">Back to Learn</a>
      </div>
    </div>
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
      <div class="mb-3 flex flex-wrap gap-2">
        <span class="chip" style="--accent: {ACCENT.azure}">
          {skillMap.get(skill.skillId)?.icon ?? ''}
          {actionName ?? skillMap.get(skill.skillId)?.name ?? skill.skillId}
          +{skill.xp} xp
          {#if skill.leveledUp && skill.level}· Lv {skill.level}!{/if}
        </span>
        {#each skill.gained as g (g.item)}
          <span class="chip" style="--accent: {ACCENT.jade}">
            +{g.count}
            {itemMap.get(g.item)?.icon ?? ''}
            {itemMap.get(g.item)?.name ?? g.item}
          </span>
        {/each}
        {#if skill.idleXp > 0}
          <span class="chip" style="--accent: {ACCENT.gold}">
            Rigs earned +{skill.idleXp} xp
          </span>
        {/if}
        {#if skill.talentUnlocked}
          <a href={href(`/skills/${skill.skillId}`)} class="chip" style="--accent: {ACCENT.gold}">
            Talent unlocked — choose one
          </a>
        {/if}
      </div>
      {#if skill.idle}
        {@const rig = skill.idle}
        {@const rigAccent = rig.maxed
          ? ACCENT.jade
          : categoryAccent(skillMap.get(skill.skillId)?.category ?? '')}
        <!-- The drill powered a machine (§13.5.1): its rate and run length, plus
             how far it is toward the run-length cap, so the learner can see when
             a rig is about done — and when it is maxed and worth switching. -->
        <div class="panel panel-accent mb-3 p-3" style="--accent: {rigAccent}">
          <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
            <span class="text-ink-300">
              Rig powered ·
              <span class="display tabular-nums" style="color: {rigAccent}"
                >{fmtInterval(rig.intervalSec)}</span
              >
              ·
              <span class="display tabular-nums" style="color: {rigAccent}"
                >{fmtClock(rig.runSec)}</span
              >
              run · +{rig.xpPerCraft} xp/item
            </span>
            <span class="display tabular-nums text-ink-300">
              {rig.maxed ? 'maxed' : `${rig.completions}/${rig.runFullAtCompletions}`}
            </span>
          </div>
          <div
            class="bar mt-2 h-1.5"
            role="progressbar"
            aria-label="Rig progress toward the {fmtClock(rig.maxRunSec)} run cap"
            aria-valuenow={Math.round(rig.runProgress * 100)}
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <i style="width: {rig.runProgress * 100}%; background: {rigAccent}"></i>
          </div>
          {#if rig.maxed}
            <p class="mt-2 text-xs text-jade-300">
              Maxed at {fmtClock(rig.maxRunSec)} — this rig runs as long and as fast as it ever will.
              Switch to another action to power a fresh one.
            </p>
          {:else}
            <p class="mt-2 text-xs text-ink-400">
              {rig.runFullAtCompletions - rig.completions} more
              {rig.runFullAtCompletions - rig.completions === 1 ? 'drill' : 'drills'} to the full
              {fmtClock(rig.maxRunSec)} run.
            </p>
          {/if}
          <!-- The live-rig cap (§13.5.1): only a couple of machines run at once, so
               drilling a fresh action stops the rig closest to finishing. -->
          <p class="mt-2 text-xs text-ink-400">
            {skill.rigsRunning ?? 1}/{skill.maxLiveRigs ?? 2} rigs running — only two run at once.
            {#if skill.stoppedRig}
              This drill stopped {skill.stoppedRig.name}.
            {/if}
          </p>
        </div>
      {/if}
    {/if}

    <div
      class="panel panel-accent p-5"
      style="--accent: {result.correct ? ACCENT.jade : ACCENT.brass}"
    >
      <div class="flex items-baseline justify-between">
        <span class="display text-lg {result.correct ? 'text-jade-300' : 'text-brass-300'}">
          {result.correct ? '✓ Correct' : '✗ Not quite'}
        </span>
        <span class="text-sm text-ink-300">{result.score}/100</span>
      </div>
      {#if result.expected}
        <p class="mt-2 text-sm text-ink-300">
          Answer: <span class="display text-lg text-ink-100">{result.expected}</span>
        </p>
      {/if}
      {#if result.feedback}
        <p class="mt-1 text-sm text-ink-400">{result.feedback}</p>
      {/if}
      {#if words.length}
        <div class="mt-3 flex flex-wrap gap-2">
          {#each words as w (w.text)}
            <span class="chip" style="--accent: {w.ok ? ACCENT.jade : ACCENT.ember}">
              {w.text}{w.tip ? ` · ${w.tip}` : ''}
            </span>
          {/each}
        </div>
      {/if}
      {#if srs}
        <p class="mt-3 text-xs text-ink-400">
          Next review <span class="gold">{reviewLabel(srs)}</span> · stability
          {srs.stability.toFixed(1)}d · difficulty {srs.difficulty.toFixed(1)}
        </p>
      {/if}
      {#if canRetry}
        <p class="mt-3 text-xs text-ink-400">
          Attempt {attempt} · say it again until it lands, or move on.
        </p>
      {/if}
    </div>
    {#if canRetry}
      <div class="mt-4 flex flex-col gap-2">
        <button onclick={retry} class="btn btn-primary w-full py-3">
          <Icon name="mic" size={15} /> Try again
        </button>
        <button onclick={nextStep} disabled={advancing} class="btn btn-ghost w-full py-3">
          {#if advancing}<Spinner size={15} label="Loading the next card" />{:else}Next →{/if}
        </button>
      </div>
    {:else if lessonCompleted && nextLessonId}
      <button onclick={nextStep} disabled={advancing} class="btn btn-primary mt-4 w-full py-3">
        {#if advancing}<Spinner size={15} label="Loading the next lesson" />{:else}Next lesson →
          {nextLessonTitle ? ` ${nextLessonTitle}` : ''}{/if}
      </button>
    {:else if !lessonCompleted}
      <button onclick={nextStep} disabled={advancing} class="btn btn-primary mt-4 w-full py-3">
        {#if advancing}<Spinner size={15} label="Loading the next card" />{:else}Next →{/if}
      </button>
    {/if}
  {:else if instance}
    {@const Comp = componentFor(instance.exerciseId)}
    {#if needsSpeech && speechWarm !== 'ready'}
      <p
        class="mb-2 flex items-center gap-2 text-xs {speechWarm === 'error'
          ? 'text-ember-300'
          : 'text-ink-400'}"
      >
        {#if speechWarm === 'error'}
          Speech model didn’t start — audio may be unavailable.
        {:else}
          <Spinner size={12} label="Starting the speech model" /> Starting the speech model…
        {/if}
      </p>
    {/if}
    <div class="panel p-5">
      <Comp {instance} {busy} onsubmit={submit} onspeak={submitAudio} />
      {#if instance.modality === 'voice'}
        <button
          type="button"
          onclick={() => applyQuiet(true)}
          class="btn btn-ghost mt-4 w-full py-2.5 text-xs"
          title="Hide listen/speak cards for 15 minutes"
        >
          <Icon name="mute" size={13} /> I can’t speak or listen right now — hide these for 15 min
        </button>
      {/if}
    </div>
  {/if}
</div>
