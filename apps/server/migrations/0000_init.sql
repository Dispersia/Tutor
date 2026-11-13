-- Phase 2 initial schema (docs/DESIGN.md §12). Keep in sync with src/db/schema.ts.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  native_lang TEXT NOT NULL DEFAULT 'en',
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_lang TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  level TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  deck_id TEXT REFERENCES decks(id),
  type TEXT NOT NULL,
  source_lang TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  readings_json TEXT NOT NULL DEFAULT '{}',
  tags_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  origin TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  deck_id TEXT,
  kind TEXT NOT NULL DEFAULT 'chat',
  lang TEXT,
  title TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  audio_ref TEXT,
  model TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  card_id TEXT,
  user_id TEXT,
  exercise_id TEXT,
  score REAL,
  latency_ms INTEGER,
  detail_json TEXT NOT NULL DEFAULT '{}',
  audio_ref TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  card_id TEXT,
  exercise_id TEXT,
  answer_json TEXT NOT NULL DEFAULT '{}',
  grade_json TEXT NOT NULL DEFAULT '{}',
  score REAL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS xp_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stats (
  user_id TEXT PRIMARY KEY,
  xp_total INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  streak_days INTEGER NOT NULL DEFAULT 0,
  last_active_day TEXT,
  daily_goal INTEGER NOT NULL DEFAULT 50,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audio_blobs (
  hash TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  bytes INTEGER,
  mime TEXT,
  seconds REAL,
  created_at INTEGER NOT NULL
);
