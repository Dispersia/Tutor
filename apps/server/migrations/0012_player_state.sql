-- Persistent combat HP (docs/DESIGN.md §13.5). HP now carries between fights:
-- the damage you take stays with you and only food/potions restore it, so
-- fleeing and re-entering a fight is no longer a free heal. `hp` is NULL until
-- the player's first fight, which means "full" (their derived max HP).

CREATE TABLE IF NOT EXISTS player_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hp INTEGER,
  updated_at INTEGER NOT NULL
);
