-- Action XP curve rebalance (docs/DESIGN.md §13.5.1). A live idle rig now earns XP
-- on its own, so the per-action curve moved 10× (skills.ts: `100 + (level−1)·10`,
-- ~58.4k XP to cap an action). This scales every stored action XP by the same 10×,
-- so nobody de-levels: because the curve scaled by exactly 10, a level is preserved
-- exactly (a level-50 action stays level 50).
--
-- Only the *action* curve moved. Drill rewards, the *account* curve (global XP /
-- `xp_events`) and combat numbers are untouched.
--
-- `action_progress.level` is denormalized — every read recomputes the level from
-- `xp` — but it is rewritten here too so the column stays honest.
UPDATE action_progress SET xp = xp * 10;

WITH RECURSIVE ladder(level, cum) AS (
  SELECT 1, 0
  UNION ALL
  SELECT level + 1, cum + (100 + (level - 1) * 10) FROM ladder WHERE level < 100
)
UPDATE action_progress
SET level = (SELECT MAX(level) FROM ladder WHERE cum <= action_progress.xp);
