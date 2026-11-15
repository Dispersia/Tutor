-- Decks are now built from a user instruction instead of being pre-seeded.
-- A deck carries its own settings (ruby/reading override, character variant,
-- exercise toggles) so a generated deck can pin its own rules, and a growth
-- cursor so it can keep growing organically from the same word list.

ALTER TABLE decks ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}';

-- Remove the pre-seeded frequency and themed decks (and their cards). New decks
-- are created on demand by the user from a frequency list.
DELETE FROM cards
WHERE deck_id IN (SELECT id FROM decks WHERE level IN ('zhfreq', 'jafreq', 'hsk1', 'n5'));
DELETE FROM decks WHERE level IN ('zhfreq', 'jafreq', 'hsk1', 'n5');
