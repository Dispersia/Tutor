-- Phase 8: talents + equipment (docs/DESIGN.md §13.5).

CREATE TABLE IF NOT EXISTS talents (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  talent_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  milestone INTEGER NOT NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, talent_id)
);

CREATE TABLE IF NOT EXISTS equipment (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  item_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, slot)
);
