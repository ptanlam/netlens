-- Dated valuations, and comps that keep themselves current.
--
-- 1. `property_valuations`. A manually-valued holding had one number, `manual_value`, and
--    the P&L history applied it to every day back to the first purchase — so booking a new
--    value moved the gain onto the day you *bought* the plot, and the old value was simply
--    overwritten. Each booking is now a dated row: a day is valued at the latest row on or
--    before it, the gain lands on the day you booked it, and undoing a booking is deleting
--    its row. `manual_value` stays, kept equal to the latest row, so everything that reads
--    today's value (net worth, the live payload, goals) needs no change at all.
--
--    The first booking also writes the value it replaced, dated at the first purchase
--    (`source = 'initial'`) — that's what the plot was carried at until then.
--
-- 2. `properties.auto_comps` — keep this many of the nearest Nhà Tốt listings as comps,
--    refreshed daily by the cron. 0 is off.
--    `property_comps.auto_for` — the property whose auto-refresh owns the row. Each refresh
--    replaces its own rows and never touches a comp you added or ticked in yourself (NULL).
--
-- Additive only: a new table and two defaulted columns, so the old Worker serving the gap
-- between migrate and deploy reads and writes exactly as before.

CREATE TABLE IF NOT EXISTS property_valuations (
  instrument TEXT    NOT NULL,
  date       TEXT    NOT NULL,
  value      INTEGER NOT NULL,
  -- 'initial' (what it was carried at before the first booking), 'estimate' (booked from
  -- the Real estate page) or 'manual' (typed on Investments).
  source     TEXT    NOT NULL DEFAULT 'manual',
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (instrument, date)
);

ALTER TABLE properties ADD COLUMN auto_comps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE property_comps ADD COLUMN auto_for TEXT;
