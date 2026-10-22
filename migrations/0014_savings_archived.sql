-- A deposit you've withdrawn had nowhere to go.
--
-- A matured deposit keeps its maturity value forever, so once the bank paid it out it went on
-- counting in net worth — twice, if you rolled the money into a new deposit. Deleting it was
-- the only way out, and that takes its history (the savings chart, past streak months) with it.
--
-- One column, like `subscriptions.cancelled_date`: NULL = still at the bank. The date is the
-- day it stopped counting, so the chart draws it up to then and drops it after.
ALTER TABLE savings ADD COLUMN archived_date TEXT;
