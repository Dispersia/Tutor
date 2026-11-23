-- A card can belong to one member (docs/DESIGN.md §12.5). Decks are shared, but
-- a reinforcement card is made for the member who kept forgetting a word: it
-- extends the deck for them alone and never changes it for anyone else.
ALTER TABLE cards ADD COLUMN private_to TEXT;

-- Reinforcement cards made before this were added to the shared deck; give each
-- back to the member it was made for.
UPDATE cards
SET private_to = user_id
WHERE user_id IS NOT NULL
  AND json_extract(payload_json, '$.reinforces') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cards_private ON cards(private_to) WHERE private_to IS NOT NULL;
