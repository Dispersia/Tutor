-- Dead schema (docs/BACKLOG.md): `attempts` was replaced by `reviews`, and the
-- remaining columns were only ever written, never read. Dropping a column
-- rewrites its table, so this is a real migration on the live database.
DROP INDEX IF EXISTS idx_attempts_user;
DROP TABLE IF EXISTS attempts;
DROP INDEX IF EXISTS idx_cards_user;
ALTER TABLE cards DROP COLUMN user_id;
ALTER TABLE sessions DROP COLUMN ended_at;
ALTER TABLE audio_blobs DROP COLUMN seconds;
ALTER TABLE talents DROP COLUMN granted_at;
ALTER TABLE srs DROP COLUMN ease;
