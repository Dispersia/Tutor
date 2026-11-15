-- Language-agnostic card metadata (docs/DESIGN.md §11.1): a JSON bag for the
-- annotations that don't fit a card's role-named content — Japanese pitch
-- accent, tone contours, radicals, mnemonics, … Keys are plain names, so a new
-- annotation kind never needs another migration.

ALTER TABLE cards ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
