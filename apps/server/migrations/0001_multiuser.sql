-- Phase 3: multi-user. Each person has their own account, settings, keys and
-- history. See docs/DESIGN.md §12.5.

ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN target_lang TEXT;
ALTER TABLE users ADD COLUMN level TEXT;
ALTER TABLE users ADD COLUMN updated_at INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- DB-backed login sessions (the cookie holds a random token; we store its hash).
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

-- Per-user settings (roles, voices, their own OpenRouter key, ...).
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- Scope the remaining tables by user so each person's history is separate.
ALTER TABLE decks ADD COLUMN user_id TEXT;
ALTER TABLE cards ADD COLUMN user_id TEXT;
ALTER TABLE attempts ADD COLUMN user_id TEXT;
ALTER TABLE audio_blobs ADD COLUMN user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_cards_user ON cards(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_xp_user ON xp_events(user_id);
