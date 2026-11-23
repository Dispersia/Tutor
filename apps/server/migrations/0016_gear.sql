-- Gear instances + saved sets (docs/DESIGN.md §13.5).
--
-- A craftable piece is not a stack: each row carries its own quality and rolled
-- stats. The inventory count remains the stack count so the bank and the older
-- equipment code keep working. Rings/trinkets use two slots each; the old
-- `weapon`/`body` slot names are renamed to the new doll slots.

CREATE TABLE IF NOT EXISTS gear_instances (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  quality TEXT NOT NULL DEFAULT 'common',
  stats_json TEXT NOT NULL DEFAULT '{}',
  armour INTEGER NOT NULL DEFAULT 0,
  power INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gear_instances_user
  ON gear_instances(user_id, item_id);

CREATE TABLE IF NOT EXISTS gear_sets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  combat_style TEXT NOT NULL DEFAULT 'general',
  slots_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gear_sets_user ON gear_sets(user_id);

ALTER TABLE equipment ADD COLUMN instance_id TEXT;
UPDATE equipment SET slot = 'mainHand' WHERE slot = 'weapon';
UPDATE equipment SET slot = 'chest' WHERE slot = 'body';

ALTER TABLE encounters ADD COLUMN monster_max_hp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE encounters ADD COLUMN monster_damage INTEGER NOT NULL DEFAULT 0;
ALTER TABLE encounters ADD COLUMN monster_level INTEGER NOT NULL DEFAULT 0;
ALTER TABLE encounters ADD COLUMN xp_reward INTEGER NOT NULL DEFAULT 0;
