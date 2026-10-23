-- A deposit's term could only be whole months, but banks also sell terms in days, weeks
-- and years. `term_months` keeps its name (renaming it would break the old Worker in the
-- gap between migrate and deploy) and now holds the term's length in `term_unit`.
ALTER TABLE savings ADD COLUMN term_unit TEXT NOT NULL DEFAULT 'month';
