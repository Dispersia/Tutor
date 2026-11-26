-- The account no longer carries a target language: what you learn is whatever
-- deck you are using, and the chat follows the language you ask in
-- (docs/DESIGN.md). Drop the leftover column.
ALTER TABLE users DROP COLUMN target_lang;
