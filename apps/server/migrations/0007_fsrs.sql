-- FSRS-6: replace the SM-2 fields with FSRS memory state (Anki-style).
-- The old `ease` column is left in place but unused.

ALTER TABLE srs ADD COLUMN state TEXT NOT NULL DEFAULT 'new';
ALTER TABLE srs ADD COLUMN step INTEGER NOT NULL DEFAULT 0;
ALTER TABLE srs ADD COLUMN stability REAL NOT NULL DEFAULT 0;
ALTER TABLE srs ADD COLUMN difficulty REAL NOT NULL DEFAULT 0;
ALTER TABLE srs ADD COLUMN last_rating INTEGER;

-- Backfill the state for any cards scheduled by the old SM-2 code: a card with
-- a day+ interval was in review; one reviewed but not yet graduated was learning.
UPDATE srs SET state = 'review' WHERE reps > 0 AND interval_days >= 1;
UPDATE srs SET state = 'learning' WHERE reps > 0 AND interval_days < 1;
