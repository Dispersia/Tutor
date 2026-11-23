import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * SQLite schema (docs/DESIGN.md §12). Cards carry a JSON payload so new card
 * types need no migration. History tables are append-only and scoped by user_id.
 */

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username'),
  passwordHash: text('password_hash'),
  handle: text('handle').notNull(),
  role: text('role').notNull().default('user'),
  nativeLang: text('native_lang').notNull().default('en'),
  targetLang: text('target_lang'),
  level: text('level'),
  settingsJson: text('settings_json').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at'),
})

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    userAgent: text('user_agent'),
  },
  (t) => [index('idx_auth_sessions_user').on(t.userId)],
)

export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value').notNull(),
})

export const decks = sqliteTable('decks', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  name: text('name').notNull(),
  sourceLang: text('source_lang').notNull(),
  targetLang: text('target_lang').notNull(),
  level: text('level'),
  description: text('description'),
  /** Deck-level overrides (ruby/reading rules, character variant, toggles). */
  settingsJson: text('settings_json').notNull().default('{}'),
})

export const cards = sqliteTable(
  'cards',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id').references(() => decks.id),
    userId: text('user_id'),
    type: text('type').notNull(),
    sourceLang: text('source_lang').notNull(),
    targetLang: text('target_lang').notNull(),
    front: text('front').notNull(),
    back: text('back').notNull(),
    readingsJson: text('readings_json').notNull().default('{}'),
    tagsJson: text('tags_json').notNull().default('[]'),
    payloadJson: text('payload_json').notNull().default('{}'),
    /** Language-agnostic annotations (pitch accent, radicals, …) — see core metadata. */
    metadataJson: text('metadata_json').notNull().default('{}'),
    origin: text('origin').notNull().default('manual'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_cards_deck').on(t.deckId), index('idx_cards_user').on(t.userId)],
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id'),
    deckId: text('deck_id'),
    kind: text('kind').notNull().default('chat'),
    lang: text('lang'),
    title: text('title'),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
  },
  (t) => [index('idx_sessions_user').on(t.userId)],
)

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    text: text('text').notNull().default(''),
    audioRef: text('audio_ref'),
    model: text('model'),
    tokensIn: integer('tokens_in').default(0),
    tokensOut: integer('tokens_out').default(0),
    costUsd: real('cost_usd').default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_messages_session').on(t.sessionId)],
)

export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(),
  cardId: text('card_id'),
  userId: text('user_id'),
  exerciseId: text('exercise_id'),
  score: real('score'),
  latencyMs: integer('latency_ms'),
  detailJson: text('detail_json').notNull().default('{}'),
  audioRef: text('audio_ref'),
  createdAt: integer('created_at').notNull(),
})

export const attempts = sqliteTable('attempts', {
  id: text('id').primaryKey(),
  sessionId: text('session_id'),
  cardId: text('card_id'),
  userId: text('user_id'),
  exerciseId: text('exercise_id'),
  answerJson: text('answer_json').notNull().default('{}'),
  gradeJson: text('grade_json').notNull().default('{}'),
  score: real('score'),
  createdAt: integer('created_at').notNull(),
})

export const xpEvents = sqliteTable('xp_events', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  amount: integer('amount').notNull(),
  reason: text('reason').notNull(),
  sourceId: text('source_id'),
  createdAt: integer('created_at').notNull(),
})

export const stats = sqliteTable('stats', {
  userId: text('user_id').primaryKey(),
  xpTotal: integer('xp_total').notNull().default(0),
  level: integer('level').notNull().default(1),
  streakDays: integer('streak_days').notNull().default(0),
  lastActiveDay: text('last_active_day'),
  dailyGoal: integer('daily_goal').notNull().default(50),
  updatedAt: integer('updated_at').notNull(),
})

/** Server-global settings (registration policy, install metadata). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

/**
 * Per-user **action** levels (docs/DESIGN.md §13.5). The level lives on the
 * action (`Mine copper`), not the profession; a profession's level is the sum of
 * its actions' levels and is derived, never stored.
 *
 * The row also carries the action's **idle rig** (§13.5.1): `completions` is how
 * many drills it has ever completed (which sets the run's speed and length),
 * `runEndsAt`/`settledAt` are the run's two timestamps, and `crafts`/`remainder`
 * are the fractional carry that keeps settlement exact. There is no timer — the
 * whole accrual is a closed-form function of these numbers and the clock.
 */
export const actionProgress = sqliteTable('action_progress', {
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  actionId: text('action_id').notNull(),
  xp: integer('xp').notNull().default(0),
  level: integer('level').notNull().default(1),
  /** lifetime drill completions — drives the rig's interval and run length */
  completions: integer('completions').notNull().default(0),
  /** ms; the rig runs while `now < run_ends_at` (0 = still) */
  runEndsAt: integer('run_ends_at').notNull().default(0),
  /** ms; accrual has been credited up to here */
  settledAt: integer('settled_at').notNull().default(0),
  /** fractional crafts carried between settles (keeps `consumes` integral) */
  crafts: real('crafts').notNull().default(0),
  /** fractional produced items per item id, as JSON */
  remainderJson: text('remainder_json').notNull().default('{}'),
  /**
   * ms; the run deadline whose "30 minutes left" alert was already sent. A drill
   * that extends the run moves `run_ends_at`, re-arming the alert (§13.5.1).
   */
  notifiedEndsAt: integer('notified_ends_at').notNull().default(0),
  /** the recipe choice this action's rig runs ('' = the first choice) */
  lastChoice: text('last_choice').notNull().default(''),
  updatedAt: integer('updated_at').notNull(),
})

/**
 * Web Push subscriptions (docs/DESIGN.md §13.5.1), one row per installed
 * device that opted in. `endpoint` is the push service URL; `p256dh`/`auth`
 * are the subscription's public key and auth secret (RFC 8291).
 */
export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: integer('created_at').notNull(),
    lastOkAt: integer('last_ok_at'),
  },
  (t) => [index('idx_push_subscriptions_user').on(t.userId)],
)

/**
 * Append-only completion log (docs/DESIGN.md §13.5.1) — one row per drill that
 * powered a rig. The live rig is an O(1) accumulator; this log exists so the bank
 * stays reconstructible from *when things were completed* alone, and so the idle
 * curve can be rebalanced later without rewriting anyone's materials.
 */
export const gatherLog = sqliteTable(
  'gather_log',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actionId: text('action_id').notNull(),
    completions: integer('completions').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_gather_log_user_action').on(t.userId, t.actionId, t.createdAt)],
)

/** Per-user materials bank. */
export const inventory = sqliteTable('inventory', {
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull(),
  count: integer('count').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
})

/** Per-user talents (one choice per 10-level milestone). */
export const talents = sqliteTable('talents', {
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  talentId: text('talent_id').notNull(),
  skillId: text('skill_id').notNull(),
  tier: text('tier').notNull(),
  milestone: integer('milestone').notNull(),
  grantedAt: integer('granted_at').notNull(),
})

/**
 * Crafted gear instances. A recipe produces a *piece*, not a stack: each row
 * carries its own quality and rolled stats. The inventory count stays the
 * stack count, so the bank and the old equipment code keep working.
 */
export const gearInstances = sqliteTable(
  'gear_instances',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemId: text('item_id').notNull(),
    slot: text('slot').notNull(),
    quality: text('quality').notNull().default('common'),
    statsJson: text('stats_json').notNull().default('{}'),
    /** JSON array of band ids enchanted onto this piece (docs §13.5.3). */
    enchantJson: text('enchant_json').notNull().default('[]'),
    armour: integer('armour').notNull().default(0),    power: integer('power').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_gear_instances_user').on(t.userId, t.itemId)],
)

/** Equipped gear, one item per slot. `instance_id` points at a crafted roll. */
export const equipment = sqliteTable('equipment', {
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  slot: text('slot').notNull(),
  itemId: text('item_id').notNull(),
  instanceId: text('instance_id'),
  updatedAt: integer('updated_at').notNull(),
})

/** Saved gear sets for quick loadout changes. */
export const gearSets = sqliteTable(
  'gear_sets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    combatStyle: text('combat_style').notNull().default('general'),
    /** JSON: slot → { itemId, instanceId? } */
    slotsJson: text('slots_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_gear_sets_user').on(t.userId)],
)

/**
 * Persistent combat state (docs/DESIGN.md §13.5). HP carries between fights —
 * damage you take stays with you and only food/potions heal it. `hp` is null
 * until the player's first fight, which means "full" (their derived max HP).
 */
export const playerState = sqliteTable('player_state', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  hp: integer('hp'),
  updatedAt: integer('updated_at').notNull(),
})

/** Per-user spaced-repetition state (FSRS-6, one row per card reviewed). */
export const srs = sqliteTable('srs', {
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  cardId: text('card_id').notNull(),
  state: text('state').notNull().default('new'),
  step: integer('step').notNull().default(0),
  stability: real('stability').notNull().default(0),
  difficulty: real('difficulty').notNull().default(0),
  reps: integer('reps').notNull().default(0),
  lapses: integer('lapses').notNull().default(0),
  ease: real('ease').notNull().default(2.5),
  intervalDays: real('interval_days').notNull().default(0),
  dueAt: integer('due_at').notNull().default(0),
  lastRating: integer('last_rating'),
  lastReviewAt: integer('last_review_at'),
})

/**
 * Append-only FSRS review log: every review that moved a schedule, practice and
 * combat alike. Enough history to replay a card (`rating` + `elapsed_days`) under
 * a future model (FSRS-7) or to train per-user weights later.
 */
export const srsReviews = sqliteTable(
  'srs_reviews',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: text('card_id').notNull(),
    /** The FSRS grade (1 = Again … 4 = Easy) this review produced. */
    rating: integer('rating').notNull(),
    stateBefore: text('state_before').notNull(),
    stateAfter: text('state_after').notNull(),
    stabilityBefore: real('stability_before').notNull(),
    stabilityAfter: real('stability_after').notNull(),
    difficultyBefore: real('difficulty_before').notNull(),
    difficultyAfter: real('difficulty_after').notNull(),
    intervalDays: real('interval_days').notNull(),
    /** Days since the previous review; fractional for same-day reviews. */
    elapsedDays: real('elapsed_days').notNull(),
    /** The desired retention in force when this review was scheduled. */
    desiredRetention: real('desired_retention').notNull(),
    dueAt: integer('due_at').notNull(),
    /** Which surface fed the schedule: `practice` or `combat`. */
    source: text('source').notNull().default('practice'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_srs_reviews_card').on(t.userId, t.cardId, t.createdAt)],
)

/** Completed curriculum lessons. */
export const lessonProgress = sqliteTable('lesson_progress', {
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  lessonId: text('lesson_id').notNull(),
  completedAt: integer('completed_at'),
})

/** The player's active combat encounter (one at a time). */
export const encounters = sqliteTable('encounters', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  monsterId: text('monster_id').notNull(),
  monsterHp: integer('monster_hp').notNull(),
  playerHp: integer('player_hp').notNull(),
  playerMaxHp: integer('player_max_hp').notNull().default(0),
  /** The scaled monster's stats for this fight (0 = use the base definition). */
  monsterMaxHp: integer('monster_max_hp').notNull().default(0),
  monsterDamage: integer('monster_damage').notNull().default(0),
  monsterLevel: integer('monster_level').notNull().default(0),
  xpReward: integer('xp_reward').notNull().default(0),
  powerBonus: real('power_bonus').notNull().default(0),
  potionId: text('potion_id'),
  foodEaten: integer('food_eaten').notNull().default(0),
  totalDamage: integer('total_damage').notNull().default(0),
  xpEarned: integer('xp_earned').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const audioBlobs = sqliteTable('audio_blobs', {
  hash: text('hash').primaryKey(),
  userId: text('user_id'),
  path: text('path').notNull(),
  bytes: integer('bytes'),
  mime: text('mime'),
  seconds: real('seconds'),
  createdAt: integer('created_at').notNull(),
})
