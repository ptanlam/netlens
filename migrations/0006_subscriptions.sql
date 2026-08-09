-- Subscriptions: recurring charges you've committed to (streaming, software, insurance,
-- the gym). They aren't assets or liabilities, so nothing here touches net worth — what
-- they are is a monthly rate of spend, which is a figure the app couldn't answer before.
--
-- `cancelled_date` is the whole cancellation story: NULL means it's still billing, a date
-- means it stopped there and no charge falls after it. Deliberately unlike `debts`, which
-- carries `archived` AND `settled_date` — that pair exists only because the date column was
-- added years later, and the two can disagree. One column can't.

CREATE TABLE IF NOT EXISTS subscriptions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  -- The charge per billing period, in whole VND — NOT a monthly figure. A yearly plan
  -- stores what the year costs; the monthly equivalent is derived (`lib/subscriptions.ts`).
  amount         INTEGER NOT NULL,
  cycle          TEXT    NOT NULL DEFAULT 'monthly',
  -- The first charge. Every later one is counted forward from here rather than chained,
  -- so a plan that bills on the 31st keeps landing on the 31st after a short month.
  start_date     TEXT    NOT NULL,
  category       TEXT    NOT NULL DEFAULT 'Other',
  payment_method TEXT,
  cancelled_date TEXT,
  note           TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
