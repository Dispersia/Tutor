-- Phase 8: auto-used consumables in combat (docs/DESIGN.md §13.5).

ALTER TABLE encounters ADD COLUMN player_max_hp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE encounters ADD COLUMN power_bonus REAL NOT NULL DEFAULT 0;
ALTER TABLE encounters ADD COLUMN potion_id TEXT;
ALTER TABLE encounters ADD COLUMN food_eaten INTEGER NOT NULL DEFAULT 0;
