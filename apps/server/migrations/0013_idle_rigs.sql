-- Idle rigs (docs/DESIGN.md §13.5.1). A completed drill no longer just hands over
-- an item: it powers that action's "rig", which then gathers/crafts on its own for
-- a while (faster and longer with every further completion). Everything is derived
-- from these recorded facts plus the clock — there are no timers and no workers.
--
--   completions   lifetime drills for this action (drives interval + run length)
--   run_ends_at   when the current run expires, ms (0 = still)
--   settled_at    accrual has been credited up to this ms cursor
--   crafts        fractional crafts carried between settles
--   remainder_json fractional produced items, keyed by item id (no rounding loss)

ALTER TABLE action_progress ADD COLUMN completions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE action_progress ADD COLUMN run_ends_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE action_progress ADD COLUMN settled_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE action_progress ADD COLUMN crafts REAL NOT NULL DEFAULT 0;
ALTER TABLE action_progress ADD COLUMN remainder_json TEXT NOT NULL DEFAULT '{}';

-- Append-only completion log: the determinism contract. The live rig is an O(1)
-- accumulator, but the bank must be reconstructible from `when things were
-- completed` alone, so the curve can be rebalanced later without rewriting banks.
CREATE TABLE IF NOT EXISTS gather_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  completions INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gather_log_user_action
  ON gather_log(user_id, action_id, created_at);
