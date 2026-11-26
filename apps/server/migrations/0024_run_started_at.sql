-- When the current run began (docs/DESIGN.md §13.5.1).
--
-- A completion now *tops the run up* by one step instead of re-basing it to
-- `rigRunSec(completions)`, so `run_ends_at` no longer implies when the run began.
-- That start is what the home screen's "gathered this rig started" figure counts
-- from, and it only moves when a drill finds the rig still. 0 means "unknown" (a
-- row written before this column); the view falls back to
-- `run_ends_at - rigRunSec(completions)` until the rig is next drilled.
ALTER TABLE action_progress ADD COLUMN run_started_at INTEGER NOT NULL DEFAULT 0;
