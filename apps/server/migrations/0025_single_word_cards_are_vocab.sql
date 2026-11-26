-- A "sentence" the deck segmented as a single token is a single word, not a
-- sentence: store it as a word card so listening/speaking drills stay
-- sentence-only (docs/DESIGN.md §11.1, §11.3). The starter decks labelled short
-- words like 네 or 謝謝 as phrase cards.
UPDATE cards
SET type = 'vocab',
    payload_json = json_set(payload_json, '$.template', 'vocab')
WHERE type = 'phrase'
  AND json_array_length(json_extract(payload_json, '$.tokens')) = 1;
