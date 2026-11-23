-- Choose-the-recipe actions (docs/DESIGN.md §13.5.3.1).
--
-- Some actions let the player pick which input to work (prospect any ore you hold;
-- cut any rough gem of a tier). They still level as ONE action, so the rig records
-- which choice it is running. '' means the action's first choice.
ALTER TABLE action_progress ADD COLUMN last_choice TEXT NOT NULL DEFAULT '';
