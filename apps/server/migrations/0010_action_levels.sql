-- Levels move from the profession onto the action (docs/DESIGN.md §13.5).
-- A profession's level is now the sum of its actions' levels, so per-user XP is
-- stored per action. Existing profession XP is carried over to that profession's
-- first action so nobody loses their progress.
--
-- The join on `users` matters: a user deleted while foreign keys were off can
-- leave orphan `skill_progress` rows, and copying those into `action_progress`
-- (where the FK *is* enforced) would abort the migration.

CREATE TABLE IF NOT EXISTS action_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, action_id)
);

INSERT INTO action_progress (user_id, action_id, xp, level, updated_at)
SELECT
  sp.user_id,
  CASE sp.skill_id
    WHEN 'mining' THEN 'mine-copper'
    WHEN 'woodcutting' THEN 'chop-oak'
    WHEN 'fishing' THEN 'fish-shrimp'
    WHEN 'farming' THEN 'farm-guam'
    WHEN 'smithing' THEN 'smelt-bronze'
    WHEN 'cooking' THEN 'cook-shrimp'
    WHEN 'herblore' THEN 'brew-attack'
    WHEN 'fletching' THEN 'fletch-oak-bow'
    WHEN 'runecrafting' THEN 'rc-air'
    WHEN 'crafting' THEN 'craft-vial'
    WHEN 'firemaking' THEN 'burn-oak'
    WHEN 'construction' THEN 'make-plank'
    WHEN 'thieving' THEN 'steal-coins'
    WHEN 'agility' THEN 'agility-drill'
    WHEN 'attack' THEN 'train-attack'
    WHEN 'strength' THEN 'train-strength'
    WHEN 'defence' THEN 'train-defence'
    WHEN 'constitution' THEN 'train-constitution'
    WHEN 'ranged' THEN 'train-ranged'
    WHEN 'magic' THEN 'train-magic'
    WHEN 'prayer' THEN 'bury-bones'
    WHEN 'slayer' THEN 'slay'
  END,
  sp.xp,
  sp.level,
  sp.updated_at
FROM skill_progress sp
JOIN users u ON u.id = sp.user_id
WHERE sp.skill_id IN (
  'mining', 'woodcutting', 'fishing', 'farming', 'smithing', 'cooking',
  'herblore', 'fletching', 'runecrafting', 'crafting', 'firemaking',
  'construction', 'thieving', 'agility', 'attack', 'strength', 'defence',
  'constitution', 'ranged', 'magic', 'prayer', 'slayer'
);

DROP TABLE IF EXISTS skill_progress;
