-- Append-only FSRS review log (docs/DESIGN.md §13.6). Every review that moves a
-- card's schedule — practice and combat alike — records the grade, the elapsed
-- interval and the before/after memory state here. That history is what lets a
-- future model (FSRS-7) replay a card, or a per-user optimizer train weights.

CREATE TABLE IF NOT EXISTS srs_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  state_before TEXT NOT NULL,
  state_after TEXT NOT NULL,
  stability_before REAL NOT NULL,
  stability_after REAL NOT NULL,
  difficulty_before REAL NOT NULL,
  difficulty_after REAL NOT NULL,
  interval_days REAL NOT NULL,
  elapsed_days REAL NOT NULL,
  desired_retention REAL NOT NULL,
  due_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'practice',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_srs_reviews_card ON srs_reviews(user_id, card_id, created_at);