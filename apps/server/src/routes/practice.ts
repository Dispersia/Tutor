import { CARD_TEMPLATES } from '@tutor/core'
import type { Card, ExerciseContext, ExerciseDef, Learner } from '@tutor/core'
import type { Context } from 'hono'
import type { App, AppEnv, Deps } from '../context'
import {
  addReview,
  cardsGradedSince,
  getCard,
  getDeck,
  getRoles,
  introducedCardIds,
  lastExerciseUse,
  listCards,
  listDecks,
  otherBacks,
} from '../db/repo'
import { exerciseCatalog, INTRODUCE_ID, registry } from '../exercises'
import {
  actionState,
  awardActionXp,
  awardXp,
  checkLessonCompletion,
  completeAction,
  knownWords,
  recordActivity,
  recordReview,
  srsStateMap,
  studyBudget,
  summary,
} from '../game/service'
import { buildLessons } from '../game/curriculum'
import { REINFORCE_LAPSES, reinforceLapsedCard } from '../deck/reinforce'
import { quietState, setQuiet } from '../game/quiet'
import { bumpDailyExtra, readStudyPrefs, showsReadings } from '../game/study'
import { ACTION_BY_ID } from '../game/skills'
import { selectCardId } from '../game/srs'
import { OpenRouter } from '../llm/openrouter'
import { MANDARIN_RULE, NATIVE_FEEDBACK_RULE } from '../llm/prompts'
import { resolveUserKey } from '../llm/userkey'
import { roleReasoning } from '../env'
import { makeAssessor, type AssessFn } from '../pronunciation/assess'
import { pinyinToZhuyin } from '../seed/zhuyin'

/**
 * How many new words open a practice sitting before the due backlog. A session
 * that starts on a long row of reviews feels like grinding; meeting a few new
 * words first keeps the session about learning, then the reviews follow.
 */
const WARMUP_NEW_CARDS = 3
/** A pause this long starts a new sitting (and warms up again). */
const SITTING_GAP_MS = 30 * 60_000

/**
 * Card selection for practice: due-first spaced repetition over the deck, except
 * that a sitting opens on a few new words before the due backlog. A card that is
 * not due is never preferred over a new word, so a word is not re-shown
 * back-to-back just because it is the only one the learner has met.
 */
function pickStudyCard(deps: Deps, userId: string, ids: string[]): Card | undefined {
  const srs = srsStateMap(deps.db, userId)
  const now = Date.now()

  // A sitting opens with a few new words (in curriculum order), then the due
  // backlog takes over. Reviews never lose their place: the warm-up only runs
  // while the sitting is young, and only when a new card is available.
  if (cardsGradedSince(deps.db, userId, now - SITTING_GAP_MS) < WARMUP_NEW_CARDS) {
    const id = ids.find((id) => !srs.has(id))
    if (id) return getCard(deps.db, id, userId)
  }

  // Due-first, then the next new word, then (only when nothing else is left) the
  // soonest card.
  const id = selectCardId(ids, srs, now)
  return id ? getCard(deps.db, id, userId) : undefined
}

/** The curriculum step a card belongs to, so the practice header can follow it. */
function lessonOfCard(deps: Deps, userId: string, card: Card): string | undefined {
  if (!card.deckId) return undefined
  const deck = getDeck(deps.db, card.deckId, userId)
  if (!deck) return undefined
  const key = deck.level ?? deck.id
  const lessons = buildLessons(key, stepCardsOf(listCards(deps.db, userId, deck.id)))
  return lessons.find((l) => l.cardIds.includes(card.id))?.id
}

/**
 * Review-only card selection for combat: never a brand-new card. Only cards that
 * already have a spaced-repetition state are eligible (due ones first), so a
 * fight never introduces vocabulary — it practises what you've already met.
 */
export function pickReviewCard(deps: Deps, userId: string, deckId?: string): Card | undefined {
  const srs = srsStateMap(deps.db, userId)
  const ids = listCards(deps.db, userId, deckId)
    .filter((c) => srs.has(c.id))
    .map((c) => c.id)
  if (ids.length === 0) return undefined
  const id = selectCardId(ids, srs, Date.now())
  return id ? getCard(deps.db, id, userId) : undefined
}

/** Maps stored cards to the curriculum builder's shape. */
function stepCardsOf(cards: Card[]) {
  return cards.map((c) => ({
    id: c.id,
    front: c.front,
    back: c.back,
    reading: displayReadingOf(c),
    // Generated decks tag each card with the n+1 step it belongs to, so a word
    // and its example cards share one lesson.
    step: typeof c.payload?.step === 'number' ? c.payload.step : undefined,
  }))
}

/**
 * Whether to show native readings for a card. A deck-level override (set when
 * the deck was generated) wins over the learner's global study preference.
 */
function showReadingsFor(
  deps: Deps,
  userId: string,
  card: Card,
  prefs: ReturnType<typeof readStudyPrefs>,
): boolean {
  const deck = card.deckId ? getDeck(deps.db, card.deckId, userId) : undefined
  return deck?.settings?.showReadings ?? showsReadings(prefs, card.targetLang)
}

/** Native reading for a card: Zhuyin (zh) or kana (ja). Never pinyin/romaji. */
function displayReadingOf(c: Card): string {
  if (c.targetLang === 'ja') return c.readings.kana || ''
  if (c.targetLang === 'zh')
    return c.readings.zhuyin || (c.readings.pinyin ? pinyinToZhuyin(c.readings.pinyin) : '')
  return Object.values(c.readings).find(Boolean) ?? ''
}

/** Display reading (Zhuyin / kana) keyed by target text, for option annotation. */
export function readingMap(
  db: Deps['db'],
  userId: string,
  targetLang: string,
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const c of listCards(db, userId)) {
    if (c.targetLang !== targetLang) continue
    map[c.back] = displayReadingOf(c)
  }
  return map
}

/**
 * Resolves a lesson id into its card ids (and its deck). The id is
 * `<key>:<index>`, where `<key>` is the deck's `level` (curated decks) or its id
 * (generated decks), so generated decks never collide.
 */
function resolveLesson(
  deps: Deps,
  userId: string,
  lessonId: string,
): { deckId: string; cardIds: string[]; key: string } | undefined {
  const sep = lessonId.lastIndexOf(':')
  if (sep <= 0) return undefined
  const key = lessonId.slice(0, sep)
  const index = Number(lessonId.slice(sep + 1)) - 1
  if (!key || !Number.isFinite(index) || index < 0) return undefined
  const deck = listDecks(deps.db, userId).find((d) => d.level === key || d.id === key)
  if (!deck) return undefined
  const cards = listCards(deps.db, userId, deck.id)
  const lesson = buildLessons(key, stepCardsOf(cards))[index]
  if (!lesson) return undefined
  return { deckId: deck.id, cardIds: lesson.cardIds, key }
}

function learnerOf(user: {
  id: string
  nativeLang: string
  targetLang: string | null
  level: string | null
}): Learner {
  return {
    id: user.id,
    nativeLang: user.nativeLang,
    targetLang: user.targetLang ?? 'zh',
    level: user.level ?? 'hsk1',
  }
}

/** "The next drill": the eligible exercise you've trained least recently. */
export function pickNextExercise(
  db: Parameters<typeof lastExerciseUse>[0],
  userId: string,
  card: Card,
  learner: Learner,
  ctx?: ExerciseContext,
  opts?: { quiet?: boolean; disabled?: ReadonlySet<string> },
): ExerciseDef<unknown> | undefined {
  let all = registry.forCard(card, learner)
  // The first-exposure "teach" step is never part of the drill rotation.
  all = all.filter((d) => d.id !== INTRODUCE_ID)
  // Exercises switched off product-wide (e.g. the pronunciation card) are never
  // offered, whatever the learner's own switches say.
  all = all.filter((d) => !d.temporarilyDisabled)
  // The learner's own switches: exercise kinds they turned off in Study settings.
  if (opts?.disabled?.size) all = all.filter((d) => !opts.disabled!.has(d.id))
  // Quiet mode ("can't speak or listen"): never offer a listen/speak card.
  if (opts?.quiet) all = all.filter((d) => d.modality !== 'voice')
  if (all.length === 0) return undefined
  // Learner-state gate (n+1 exercises are only offered once they can be built).
  const eligible = ctx ? all.filter((d) => !d.available || d.available(ctx)) : all
  const pool = eligible.length > 0 ? eligible : all
  if (pool.length <= 1) return pool[0]
  const lastUse = lastExerciseUse(db, userId)
  const oldest = Math.min(...pool.map((d) => lastUse.get(d.id) ?? 0))
  const ties = pool.filter((d) => (lastUse.get(d.id) ?? 0) === oldest)
  return ties[Math.floor(Math.random() * ties.length)]
}

/** A helpful message when no drill can be offered for a card. */
function noDrillMessage(disabled: ReadonlySet<string>): string {
  return disabled.size
    ? 'Every exercise kind for this card is turned off — re-enable some in Settings › Study.'
    : 'No exercise available for this card.'
}

/** Builds the optional LLM judge for this user (absent when no key is set). */
async function judgeFor(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const key = await resolveUserKey(deps, user.id)
  if (!key) return undefined
  const model = getRoles(deps.db, user.id, deps.defaults).judge
  const or = new OpenRouter(key, deps.or.baseUrl)
  const system = [
    'You are a strict but encouraging language tutor. Reply with only the requested JSON.',
    NATIVE_FEEDBACK_RULE(user.nativeLang),
    MANDARIN_RULE,
  ].join('\n')
  return async (prompt: string, schema: object): Promise<unknown> => {
    const { json } = await or.chatJSON({
      model,
      schema,
      schemaName: 'grade',
      reasoning: roleReasoning.judge,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    })
    return json
  }
}

/** Applies action XP + the idle-rig economy for a completed action. */
function settleAction(
  deps: AppEnv['Variables']['deps'],
  userId: string,
  actionId: string | undefined,
  result: { correct: boolean; score: number },
) {
  const action = actionId ? ACTION_BY_ID.get(actionId) : undefined
  if (!action) return null
  const minScore = action.minScore ?? 70
  const success = result.correct && result.score >= minScore
  if (!success) {
    return {
      actionId: action.id,
      skillId: action.skillId,
      xp: 0,
      level: null,
      skillLevel: null,
      leveledUp: false,
      gained: [],
      consumed: [],
      idle: null,
      idleXp: 0,
      talentUnlocked: null,
    }
  }
  const award = awardActionXp(deps.db, deps.events, userId, action.id, action.xp)
  // The drill powers the rig (docs/DESIGN.md §13.5.1): it pays every running rig up
  // to now, lands the strike, then makes this action's run faster and longer. What
  // `gained` reports is the whole windfall — the strike plus what the runs made —
  // and `idleXp` is the XP those runs earned on their own while you were away.
  const rig = completeAction(deps.db, deps.events, userId, action.id)
  return {
    actionId: award.actionId,
    skillId: award.skillId,
    xp: award.gained,
    level: award.level,
    skillLevel: award.skillLevel,
    leveledUp: award.leveledUp,
    gained: rig.gained,
    consumed: rig.consumed,
    idle: rig.idle,
    idleXp: rig.xp,
    talentUnlocked: award.talentUnlocked,
  }
}

export function registerPractice(app: App) {
  app.get('/api/exercises', (c) => c.json({ exercises: exerciseCatalog() }))

  // The reusable card templates (vocab, spoken, listening, sentence, grammar):
  // each names the content it needs and the exercises that realise it.
  app.get('/api/templates', (c) => c.json({ templates: CARD_TEMPLATES }))

  // "I can't speak or listen right now": hide listen/speak cards for 15 minutes.
  // It is a time-boxed window that lifts on its own; XP is unaffected.
  app.post('/api/practice/quiet', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean }
    const state = setQuiet(deps.db, user.id, Boolean(body.enabled))
    return c.json({ quietUntil: state.until })
  })

  app.post('/api/practice/next', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as {
      deckId?: string
      exerciseId?: string
      actionId?: string
      lessonId?: string
      /** Drill this card specifically (a targeted drill; the budget still applies). */
      cardId?: string
    }
    const quiet = quietState(deps.db, user.id)
    // The learner's own switches: readings visibility + exercise kinds they turned off.
    const prefs = readStudyPrefs(deps.db, user.id)
    const disabled = new Set(prefs.disabledExercises)

    const action = body.actionId ? ACTION_BY_ID.get(body.actionId) : undefined
    if (body.actionId && !action) return c.json({ error: 'unknown action' }, 404)

    let deckId = body.deckId
    if (action) {
      const state = actionState(deps.db, user.id, action)
      if (!state.unlocked) {
        return c.json(
          {
            error: 'action locked',
            missingUnlocks: state.missingUnlocks,
            equipMissing: state.equipMissing,
          },
          403,
        )
      }
      if (!state.affordable) {
        return c.json({ error: 'missing materials', missing: state.missing }, 409)
      }
      if (action.deckLevel) {
        const deck = listDecks(deps.db, user.id).find((d) => d.level === action.deckLevel)
        if (deck) deckId = deck.id
      }
    }

    // A guided-curriculum lesson only picks the deck: the path decides the card.
    // (Scoping to the lesson's own cards would re-show a one-word step four times
    // in a row while its learning step waits.)
    if (body.lessonId) {
      const lesson = resolveLesson(deps, user.id, body.lessonId)
      if (!lesson) return c.json({ error: 'unknown lesson' }, 404)
      deckId = lesson.deckId
    }

    // Nothing named a deck: free practice drills the learner's active deck, the
    // one chosen in the profile menu — so the choice applies everywhere.
    if (!deckId && prefs.activeDeckId && getDeck(deps.db, prefs.activeDeckId, user.id)) {
      deckId = prefs.activeDeckId
    }

    // Daily budget (Anki-style limits): new cards and reviews are capped per UTC
    // day; "study more" raises today's allowance. A new card is one with no SRS
    // state yet, everything else (learning + review) draws on the review budget.
    const budget = studyBudget(deps.db, user.id)
    const allowNew = budget.newUnlimited || budget.newRemaining > 0
    const allowReview = budget.reviewsUnlimited || budget.reviewsRemaining > 0
    const srsForBudget = srsStateMap(deps.db, user.id)
    let allowedIds = listCards(deps.db, user.id, deckId)
      .map((c) => c.id)
      .filter((id) => (srsForBudget.has(id) ? allowReview : allowNew))
    // A specific card can be drilled directly; it still draws on the day's budget.
    if (body.cardId) {
      if (!getCard(deps.db, body.cardId, user.id)) return c.json({ error: 'card not found' }, 404)
      allowedIds = allowedIds.filter((id) => id === body.cardId)
    }
    if (allowedIds.length === 0) {
      return c.json({ instance: null, action: null, done: true, budget })
    }

    const card = pickStudyCard(deps, user.id, allowedIds)
    if (!card) return c.json({ instance: null, action: null, done: true, budget })
    // The queue moves along the path; the practice header follows the card.
    const servedLessonId = body.lessonId ? lessonOfCard(deps, user.id, card) : undefined

    const learner = learnerOf(user)
    const srs = srsStateMap(deps.db, user.id)
    const introduced = introducedCardIds(deps.db, user.id)
    const known = knownWords(deps.db, user.id)
    // Words the learner has met (introduced or reviewed): the n+1 vocabulary for
    // a first-exposure example sentence.
    const seen = new Set(known)
    for (const c of listCards(deps.db, user.id))
      if (introduced.has(c.id) || srs.has(c.id)) seen.add(c.back)

    const ctx = {
      card,
      learner,
      distractors: otherBacks(deps.db, user.id, card.targetLang, card.back, 3),
      readings: readingMap(deps.db, user.id, card.targetLang),
      known: [...known, card.back],
      seen: [...seen, card.back],
      showReadings: showReadingsFor(deps, user.id, card, prefs),
      judge: await judgeFor(c),
    }

    // First exposure: teach the concept before quizzing. A card with no SRS state
    // that has not been introduced yet gets the "meet the word" step; the learner
    // taps Continue, then the same card comes back as a normal drill.
    // Only word cards get the first-exposure "meet the word" step: sentence and
    // grammar cards are built from words the learner already knows (n+1), so
    // there is nothing new to introduce.
    const teachable = !card.payload?.template || card.payload.template === 'vocab'
    const isNewCard = !srs.has(card.id)
    if (!body.exerciseId && teachable && isNewCard && !introduced.has(card.id)) {
      const intro = registry.get(INTRODUCE_ID)
      if (intro)
        return c.json({
          instance: await intro.generate(ctx),
          action: null,
          lessonId: servedLessonId,
        })
    }

    const def = body.exerciseId
      ? registry.get(body.exerciseId)
      : pickNextExercise(deps.db, user.id, card, learner, ctx, { quiet: quiet.active, disabled })
    if (!def) return c.json({ error: noDrillMessage(disabled) }, 409)
    // A voice card can't be forced while quiet mode is on, a kind the learner
    // turned off is swapped for one that is allowed, and a product-wide off
    // exercise (the pronunciation card) is never served even when forced.
    const blocked = (d: typeof def) =>
      d.temporarilyDisabled || (quiet.active && d.modality === 'voice') || disabled.has(d.id)
    const chosen = blocked(def)
      ? pickNextExercise(deps.db, user.id, card, learner, ctx, { quiet: quiet.active, disabled })
      : def
    if (!chosen) return c.json({ error: noDrillMessage(disabled) }, 409)

    const instance = await chosen.generate(ctx)
    // A listening card is about to be shown: make sure its recorded audio exists
    // (no-op when it was already recorded when the card was created).
    if (chosen.id === 'type_listen') {
      deps.audio?.enqueue([{ userId: user.id, text: card.back, language: card.targetLang }])
    }
    return c.json({
      instance,
      action: action
        ? {
            id: action.id,
            skillId: action.skillId,
            xp: action.xp,
            produces: action.produces ?? [],
            consumes: action.consumes ?? [],
          }
        : null,
      lessonId: servedLessonId,
    })
  })

  // "Study more" (Anki's custom study): raise today's new/review allowance so a
  // motivated learner can keep going past the daily goal.
  app.post('/api/study/more', (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const prefs = readStudyPrefs(deps.db, user.id)
    bumpDailyExtra(deps.db, user.id, {
      newExtra: prefs.newPerDay > 0 ? prefs.newPerDay : 0,
      reviewsExtra: prefs.maxReviewsPerDay > 0 ? prefs.maxReviewsPerDay : 0,
    })
    return c.json({ ok: true, budget: studyBudget(deps.db, user.id) })
  })

  app.post('/api/practice/grade', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as {
      exerciseId?: string
      cardId?: string
      answer?: unknown
      latencyMs?: number
      actionId?: string
      lessonId?: string
    }
    const card = body.cardId ? getCard(deps.db, body.cardId, user.id) : undefined
    if (!card) return c.json({ error: 'card not found' }, 404)
    const def = body.exerciseId ? registry.get(body.exerciseId) : undefined
    if (!def) return c.json({ error: 'exercise not found' }, 404)

    // an action must be unlocked and affordable before it can settle
    if (body.actionId) {
      const action = ACTION_BY_ID.get(body.actionId)
      if (!action) return c.json({ error: 'unknown action' }, 404)
      const state = actionState(deps.db, user.id, action)
      if (!state.unlocked) {
        return c.json(
          {
            error: 'action locked',
            missingUnlocks: state.missingUnlocks,
            equipMissing: state.equipMissing,
          },
          403,
        )
      }
      if (!state.affordable)
        return c.json({ error: 'missing materials', missing: state.missing }, 409)
    }

    const learner = learnerOf(user)
    const ctx = {
      card,
      learner,
      distractors: otherBacks(deps.db, user.id, card.targetLang, card.back, 3),
      readings: readingMap(deps.db, user.id, card.targetLang),
      known: [...knownWords(deps.db, user.id), card.back],
      showReadings: showReadingsFor(deps, user.id, card, readStudyPrefs(deps.db, user.id)),
      judge: await judgeFor(c),
    }
    const instance = await def.generate(ctx)
    const result = await def.grade(ctx, instance, body.answer)
    const xp = def.id === INTRODUCE_ID ? 0 : def.xp(result, instance)

    addReview(deps.db, {
      cardId: card.id,
      userId: user.id,
      exerciseId: def.id,
      score: result.score,
      latencyMs: body.latencyMs,
      detail: result.detail,
    })
    // A first-exposure "teach" step records that the card was introduced, but is
    // not a recall test: no XP, no schedule, no lesson completion.
    if (def.id === INTRODUCE_ID) {
      return c.json({
        result: { ...result, xp, leveledUp: false },
        skill: null,
        srs: null,
        lessonCompleted: false,
        stats: summary(deps.db, user.id),
      })
    }
    const { leveledUp } = awardXp(deps.db, deps.events, user.id, xp, 'review', def.id)
    recordActivity(deps.db, deps.events, user.id)
    deps.events.emit('review.completed', {
      userId: user.id,
      cardId: card.id,
      exerciseId: def.id,
      score: result.score,
      correct: result.correct,
    })
    const skill = settleAction(deps, user.id, body.actionId, result)
    const srs = recordReview(deps.db, deps.events, user.id, card.id, result.score, result.correct)
    // A word that keeps slipping gets an extra card woven in beside it (n+1),
    // in the background so the learner never waits on the generator.
    if (
      card.payload?.template === 'vocab' &&
      srs.lapses >= REINFORCE_LAPSES &&
      readStudyPrefs(deps.db, user.id).autoReinforce
    ) {
      void reinforceLapsedCard(deps, user.id, card.id).catch(() => {})
    }
    const lessonCompleted = body.lessonId
      ? checkLessonCompletion(deps.db, deps.events, user.id, body.lessonId)
      : false

    return c.json({
      result: { ...result, xp, leveledUp },
      skill,
      srs,
      lessonCompleted,
      stats: summary(deps.db, user.id),
    })
  })

  // Pronunciation: recorded audio -> ASR + forced alignment -> score + tips (§9.4).
  app.post('/api/practice/speak', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const form = await c.req.formData()
    const file = form.get('file')
    const cardId = String(form.get('cardId') ?? '')
    const exerciseId = String(form.get('exerciseId') ?? '')
    const actionId = form.get('actionId') ? String(form.get('actionId')) : undefined
    const lessonId = form.get('lessonId') ? String(form.get('lessonId')) : undefined
    const latencyMs = Number(form.get('latencyMs') ?? 0)
    // A retry is the learner re-recording the same card after a miss, to keep
    // practising until it lands (§9.4). It is graded like any attempt but never
    // counted: no review row, no XP, no schedule — only the first attempt counts.
    const retry = String(form.get('retry') ?? '') === 'true'

    if (!(file instanceof File)) return c.json({ error: 'audio file required' }, 400)
    const card = cardId ? getCard(deps.db, cardId, user.id) : undefined
    if (!card) return c.json({ error: 'card not found' }, 404)
    const def = exerciseId ? registry.get(exerciseId) : undefined
    if (!def?.gradeAudio) return c.json({ error: 'exercise does not support audio grading' }, 400)

    if (actionId) {
      const action = ACTION_BY_ID.get(actionId)
      if (!action) return c.json({ error: 'unknown action' }, 404)
      const state = actionState(deps.db, user.id, action)
      if (!state.unlocked) {
        return c.json(
          {
            error: 'action locked',
            missingUnlocks: state.missingUnlocks,
            equipMissing: state.equipMissing,
          },
          403,
        )
      }
      if (!state.affordable)
        return c.json({ error: 'missing materials', missing: state.missing }, 409)
    }

    const audio = new Uint8Array(await file.arrayBuffer())
    const learner = learnerOf(user)
    // No ASR biasing here: the deck vocabulary is deliberately kept out of the
    // decode. Whisper would fold it into its initial prompt and read a course word
    // back out (saying いる, hearing います), so grading stays honest and the
    // forced aligner anchors to the expected text instead.
    const assess: AssessFn = deps.assess ?? makeAssessor(deps, card.targetLang)
    const ctx = {
      card,
      learner,
      distractors: [] as string[],
      readings: readingMap(deps.db, user.id, card.targetLang),
      known: [...knownWords(deps.db, user.id), card.back],
      showReadings: showReadingsFor(deps, user.id, card, readStudyPrefs(deps.db, user.id)),
      judge: await judgeFor(c),
      assess,
    }

    try {
      const instance = await def.generate(ctx)
      const result = await def.gradeAudio(ctx, instance, audio)
      // A silent/too-short clip must not count as a wrong answer: no review, no
      // XP, no SRS — just ask for another attempt. A retry (re-recording the same
      // card) is graded the same way but also stays out of the schedule.
      if (result.detail?.noSpeech || retry) {
        return c.json({
          result: { ...result, xp: 0 },
          skill: null,
          srs: null,
          lessonCompleted: false,
          stats: summary(deps.db, user.id),
        })
      }
      const xp = def.xp(result, instance)
      addReview(deps.db, {
        cardId: card.id,
        userId: user.id,
        exerciseId: def.id,
        score: result.score,
        latencyMs,
        detail: result.detail,
      })
      const { leveledUp } = awardXp(deps.db, deps.events, user.id, xp, 'review', def.id)
      recordActivity(deps.db, deps.events, user.id)
      deps.events.emit('review.completed', {
        userId: user.id,
        cardId: card.id,
        exerciseId: def.id,
        score: result.score,
        correct: result.correct,
      })
      const skill = settleAction(deps, user.id, actionId, result)
      const srs = recordReview(deps.db, deps.events, user.id, card.id, result.score, result.correct)
      const lessonCompleted = lessonId
        ? checkLessonCompletion(deps.db, deps.events, user.id, lessonId)
        : false
      return c.json({
        result: { ...result, xp, leveledUp },
        skill,
        srs,
        lessonCompleted,
        stats: summary(deps.db, user.id),
      })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502)
    }
  })
}
