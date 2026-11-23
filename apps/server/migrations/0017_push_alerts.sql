-- Web Push subscriptions (RFC 8291/8292) and rig alerts (docs/DESIGN.md §13.5.1).
--
-- One row per installed PWA/device that opted in. The endpoint is the push
-- service URL; p256dh/auth are the subscription's public key and auth secret.
-- A device that revokes the subscription answers 404/410 and its row is dropped.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  last_ok_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id);

-- The run deadline whose "running low" alert was already sent. A drill that
-- extends the run moves run_ends_at, which re-arms the alert; a restart or a
-- second scan never notifies twice for the same deadline.
ALTER TABLE action_progress ADD COLUMN notified_ends_at INTEGER NOT NULL DEFAULT 0;
