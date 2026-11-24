-- Action XP curve rebalance (docs/DESIGN.md §13.5). The linear `100 + (level−1)·10`
-- curve made the whole climb feel flat and fast. The new curve is quadratic:
-- `50 + ⌊(level−1)² / 4⌋`, so early levels stay quick and later levels get steep.
--
-- Existing rows keep their current level: the stored XP is mapped from the old
-- curve to the same point of the new one, preserving within-level progress. No
-- action levels up or down from this migration alone.
WITH RECURSIVE
  old_curve(level, cum, cost) AS (
    SELECT 1, 0, 100
    UNION ALL
    SELECT level + 1, cum + cost, 100 + level * 10 FROM old_curve WHERE level < 100
  ),
  new_curve(level, cum, cost) AS (
    SELECT 1, 0, 50
    UNION ALL
    SELECT level + 1, cum + cost, 50 + (level * level) / 4 FROM new_curve WHERE level < 100
  )
UPDATE action_progress
SET
  xp = (
    SELECT
      new_curve.cum + CAST(
        (
          MAX(0, MIN(old_curve.cost, action_progress.xp - old_curve.cum)) * 1.0
          / old_curve.cost
        ) * new_curve.cost AS INTEGER
      )
    FROM new_curve
    JOIN old_curve ON old_curve.level = new_curve.level
    WHERE new_curve.level = MIN(100, MAX(1, action_progress.level))
  ),
  level = MIN(100, MAX(1, level));