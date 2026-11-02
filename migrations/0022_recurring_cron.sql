-- A recurring rule can run on a cron expression instead of a fixed step: `freq` = 'cron' and
-- this holds the 5-field expression (`lib/cron.ts`). The rule runs once on each day it
-- matches; minute and hour are ignored. NULL for every other frequency. Additive.
ALTER TABLE recurring_rules ADD COLUMN cron TEXT;
