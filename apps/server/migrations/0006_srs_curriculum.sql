-- Phase 9: spaced repetition + guided curriculum (docs/DESIGN.md §13.6).

CREATE TABLE IF NOT EXISTS srs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  ease REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL DEFAULT 0,
  last_review_at INTEGER,
  PRIMARY KEY (user_id, card_id)
);

CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY (user_id, lesson_id)
);
