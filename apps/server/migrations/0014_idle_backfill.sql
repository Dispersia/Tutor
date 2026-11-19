-- Idle-rig backfill (docs/DESIGN.md §13.5.1). Migration 0013 added `completions`
-- defaulting to 0, which would leave every existing account's rigs at the slowest
-- tier (10s / 10min) despite weeks of play — and, worse, make it look like nothing
-- happened. Approximate lifetime completions from the action's level: bounded,
-- monotone, and deliberately conservative (the real drill count is higher at high
-- levels, so a veteran's rig starts fast rather than absurdly fast).
UPDATE action_progress SET completions = level WHERE completions = 0 AND level > 0;
