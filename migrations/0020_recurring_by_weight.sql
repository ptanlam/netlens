-- A recurring rule can buy a fixed weight instead of a fixed amount: gold, which is never
-- priced into units out of an amount (see `METALS`). NULL = an ordinary amount rule. For a
-- weight rule `amount` is only the estimate at save time (weight × the dealer's sell price);
-- each run books the weight at that day's sell price. Additive: an old Worker ignores it.
ALTER TABLE recurring_rules ADD COLUMN quantity REAL;
