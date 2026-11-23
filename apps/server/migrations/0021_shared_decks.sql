-- Decks are shared by every member (docs/DESIGN.md §12.5): `decks.user_id` and
-- `cards.user_id` now only record who created the row.

-- Lessons are addressed by deck id, never by the deck's free-text `level`: two
-- decks with the same level used to share one set of lesson ids (and one
-- member's progress). Re-key the rows that used a level, preferring the
-- member's own deck when several decks carry that level.
UPDATE OR IGNORE lesson_progress
SET lesson_id = (
  SELECT d.id FROM decks d
  WHERE d.level = substr(lesson_progress.lesson_id, 1, instr(lesson_progress.lesson_id, ':') - 1)
  ORDER BY (d.user_id = lesson_progress.user_id) DESC
  LIMIT 1
) || substr(lesson_id, instr(lesson_id, ':'))
WHERE instr(lesson_id, ':') > 1
  AND EXISTS (
    SELECT 1 FROM decks d
    WHERE d.level = substr(lesson_progress.lesson_id, 1, instr(lesson_progress.lesson_id, ':') - 1)
  );

-- 0020 added indexes that repeat the leading column of a primary key, and one
-- that duplicates idx_xp_user: they cost a write on every upsert and buy nothing.
DROP INDEX IF EXISTS idx_inventory_user;
DROP INDEX IF EXISTS idx_action_progress_user;
DROP INDEX IF EXISTS idx_talents_user;
DROP INDEX IF EXISTS idx_equipment_user;
DROP INDEX IF EXISTS idx_lesson_progress_user;
DROP INDEX IF EXISTS idx_srs_user;
DROP INDEX IF EXISTS idx_xp_events_user;

-- The rig-alert scan runs every minute across all members and filters on the
-- run's end; only rows with a run have one.
CREATE INDEX IF NOT EXISTS idx_action_progress_run_end
  ON action_progress(run_ends_at) WHERE run_ends_at > 0;
