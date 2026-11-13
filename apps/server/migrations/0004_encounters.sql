-- Phase 8: combat encounters (docs/DESIGN.md §13.5).

CREATE TABLE IF NOT EXISTS encounters (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  monster_id TEXT NOT NULL,
  monster_hp INTEGER NOT NULL,
  player_hp INTEGER NOT NULL,
  total_damage INTEGER NOT NULL DEFAULT 0,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
