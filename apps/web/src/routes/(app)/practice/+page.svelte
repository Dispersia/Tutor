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
    type Deck,
    type Grade,
    type Instance,
    type SrsOutcome,
    type Stats,
    type WordFeedback,
  } from '#lib/exercises'
  import { getSkills, type SkillOutcome, type SkillsResponse } from '#lib/skills'
  import { getCurriculum, type CurriculumDeck, type LessonDTO } from '#lib/curriculum'
  import { href } from '#lib/paths'
  import { wakeSpeech } from '#lib/speech'
  import { ACCENT } from '#lib/theme'
  import Icon from '#lib/components/Icon.svelte'
  import Spinner from '#lib/components/Spinner.svelte'

  let decks = $state<Deck[]>([])
  let deckId = $state<string>('')
  let instance = $state<Instance | null>(null)
  let result = $state<Grade | null>(null)
  let skill = $state<SkillOutcome | null>(null)
  let srs = $state<SrsOutcome | null>(null)
  let stats = $state<Stats | null>(null)
  let ref = $state<SkillsResponse | null>(null)
  let lesson = $state<LessonDTO | null>(null)
  let lessonCompleted = $state(false)
  /** The full path, so we can find the lesson that follows the current one. */
  let curriculum = $state<CurriculumDeck[]>([])
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
  let quietUntil = $state(0)
  /** Ticking clock so the quiet countdown and expiry update live. */
  let now = $state(Date.now())

  const actionId = $derived(page.url.searchParams.get('action') ?? undefined)
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

  onMount(async () => {
    try {
      const [d, s, sk] = await Promise.all([listDecks(), getStats(), getSkills().catch(() => null)])
      decks = d.decks
      deckId = deckParam ?? decks[0]?.id ?? ''
      stats = s
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

  async function loadNext() {
    error = ''
    result = null
    skill = null
    srs = null
    lessonCompleted = false
    instance = null
    speechWarm = 'idle'
    try {
      const body: { actionId?: string; lessonId?: string; deckId?: string } = {}
      if (actionId) body.actionId = actionId
      if (lessonId) body.lessonId = lessonId
      if (!actionId && !lessonId && deckId) body.deckId = deckId
      const r = await nextExercise(body)
      instance = r.instance
      startedAt = Date.now()
      if (r.instance.modality === 'voice' || r.instance.modality === 'mixed') void warmSpeech()
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
    try {
      const r = await gradeExercise({
        exerciseId: instance.exerciseId,
        cardId: instance.cardId,
        answer,
        latencyMs: Date.now() - startedAt,
        actionId,
        lessonId,
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
      srs = r.srs ?? null
      lessonCompleted = Boolean(r.lessonCompleted)
      stats = r.stats
      quietUntil = r.stats.quietUntil ?? quietUntil
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

<div class="flex items-center justify-between border-b border-ink-700 pt-4 pb-3">
  <div>
    <h1 class="display text-2xl text-ink-100">
      {actionId ? skillName : lesson ? lesson.title : 'Free practice'}
    </h1>
    <p class="mt-1 text-xs text-ink-400">
      {actionId
        ? actionName
        : lesson
          ? `${lessonLabel(lesson)} · ${lesson.learned}/${lesson.cards} learned`
          : 'Spaced repetition picks what’s due'}
    </p>
  </div>
  <div class="flex items-center gap-2 text-xs">
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
      class="chip cursor-pointer gap-1"
      style="--accent: {quietActive ? ACCENT.brass : ACCENT.azure}"
      title={quietActive
        ? 'Listen & speak cards return when this ends — turn it off now'
        : 'Hide listen & speak cards for 15 min'}
      aria-pressed={quietActive}
    >
      <Icon name="mute" size={12} />
      {quietActive ? quietClock : 'Can’t speak?'}
    </button>
    <span class="chip" style="--accent: {ACCENT.gold}">{stats?.xp ?? 0} XP</span>
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

{#if !focused}
  <select
    value={deckId}
    onchange={changeDeck}
    class="mb-4 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm"
  >
    {#each decks as d (d.id)}
      <option value={d.id}>{d.name} · {d.cardCount} cards</option>
    {/each}
  </select>
{/if}

{#if loading}
  <p class="flex items-center gap-2 text-sm text-ink-400">
    <Spinner size={14} label="Loading practice" /> Loading…
  </p>
{:else if error}
  <p class="rounded-lg bg-ember-950 px-3 py-2 text-sm text-ember-300">{error}</p>
  <button onclick={loadNext} class="mt-3 rounded-md border border-ink-600 px-3 py-2 text-sm"
    >Back</button
  >
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
      {#if skill.talentUnlocked}
        <a href={href(`/skills/${skill.skillId}`)} class="chip" style="--accent: {ACCENT.gold}">
          Talent unlocked — choose one
        </a>
      {/if}
    </div>
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
  </div>
  {#if lessonCompleted && nextLessonId}
    <button
      onclick={nextStep}
      disabled={advancing}
      class="btn btn-primary mt-4 w-full py-3 disabled:opacity-60"
    >
      {#if advancing}<Spinner size={15} label="Loading the next lesson" />{:else}Next lesson →
        {nextLessonTitle ? ` ${nextLessonTitle}` : ''}{/if}
    </button>
  {:else if !lessonCompleted}
    <button
      onclick={nextStep}
      disabled={advancing}
      class="btn btn-primary mt-4 w-full py-3 disabled:opacity-60"
    >
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
