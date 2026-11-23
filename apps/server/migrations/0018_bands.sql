-- Material tier bands (docs/DESIGN.md §13.5.3).
--
-- A band's deep salvage yields a *reagent*, and Enchanting spends a reagent to put
-- that band's signature stat on any higher-tier piece. The enchant lives on the
-- crafted instance as a JSON array of band ids, so one piece can carry a bronze
-- (crit) enchant and an iron (lifesteal) enchant without any new tables.
ALTER TABLE gear_instances ADD COLUMN enchant_json TEXT NOT NULL DEFAULT '[]';
