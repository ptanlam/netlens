-- A holding can be earmarked for a sinking fund, the way a deposit can (`savings.goal_id`):
-- the whole holding, at today's value, fills the fund and is left out of net-worth goals.
-- NULL = not earmarked. On `instruments` itself, so a rename carries it along and nothing
-- needs adding to `NAME_COLUMNS`. Additive.
ALTER TABLE instruments ADD COLUMN goal_id INTEGER;
