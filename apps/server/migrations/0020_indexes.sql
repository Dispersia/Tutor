-- Hot-path indexes (docs/ARCHITECTURE.md). Nearly every repository read
-- filters by user_id, and the review/XP queries also filter or group by card and
-- day; without these, SQLite scans the whole table on every practice step.
CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_card ON reviews(card_id);
CREATE INDEX IF NOT EXISTS idx_xp_events_user ON xp_events(user_id);
CREATE INDEX IF NOT EXISTS idx_srs_user ON srs(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory(user_id);
CREATE INDEX IF NOT EXISTS idx_action_progress_user ON action_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_talents_user ON talents(user_id);
CREATE INDEX IF NOT EXISTS idx_equipment_user ON equipment(user_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_user ON lesson_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id);
