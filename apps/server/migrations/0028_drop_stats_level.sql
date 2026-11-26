-- `stats.level` held the global-XP level, which is gone: the only level a member
-- sees is the account level (the mean of their skill levels) and the per-skill
-- levels. Dropping a column rewrites its table, so this is a real migration on
-- the live database.
ALTER TABLE stats DROP COLUMN level;
