-- Settling a debt erased it from "Debt owed over time".
--
-- `archived` says a debt owes nothing *from here on*, but it carries no date, so the chart
-- had no way to draw the years you spent paying it and then stop. Drawing it with the same
-- `debtOwed` the table uses was worse than useless: on a `fixed` loan the balance accrues
-- toward maturity however much you've repaid, so a closed loan's line climbed back out of
-- zero for the rest of the chart. The only safe move was to leave settled debts out
-- entirely — which threw away exactly the history you closed the debt to keep.
--
-- So record *when* it was settled. The chart draws each debt up to that date and drops it
-- to zero after, which is what actually happened, and the totals are unaffected because a
-- settled debt already owes 0.
--
-- Backfill from the last repayment: for debts closed before this column existed that is
-- the best evidence of when they were paid off. One with no payments at all stays NULL and
-- the chart skips it, as it did before.
ALTER TABLE debts ADD COLUMN settled_date TEXT;

UPDATE debts
   SET settled_date = (SELECT MAX(p.date) FROM debt_payments p WHERE p.debt_id = debts.id)
 WHERE archived = 1;
