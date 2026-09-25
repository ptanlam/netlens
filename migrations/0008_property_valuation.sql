-- Estimating what a piece of land is worth from where it is.
--
-- There is no API for Vietnamese property prices worth trusting, so the estimate is built
-- from evidence you collect yourself: comparable plots (a sale you heard about, a listing
-- you saw) near yours, plus an optional area index to carry an old comp — or what you paid —
-- forward to today. The maths is in `lib/realestate.ts`; nothing it derives is stored.
--
-- Additive only: three new tables, nothing existing touched, so the old Worker serving the
-- gap between migrate and deploy never notices.

-- Where a Real Estate holding sits and what kind of plot it is. Keyed by the holding's name,
-- exactly as `transactions.instrument` and `price_history.instrument` are — the holding
-- stays the thing net worth reads; this row only describes it.
CREATE TABLE IF NOT EXISTS properties (
  instrument TEXT PRIMARY KEY,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  area_m2    REAL NOT NULL,
  -- 'residential' (đất ở / thổ cư), 'agricultural', or 'mixed'. A comp only counts if it
  -- matches: residential land trades at several times agricultural land next door.
  land_use   TEXT NOT NULL DEFAULT 'residential',
  -- 'street' (mặt tiền), 'alley' (hẻm), or 'none'. A soft match — a mismatch down-weights.
  access     TEXT NOT NULL DEFAULT 'alley',
  -- How far out a comp may be and still count. Land prices shift block by block in a city
  -- and village by village outside one, so this is yours to set.
  radius_km  REAL NOT NULL DEFAULT 3,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Comparable plots. Deliberately not tied to a property: a comp is a fact about the world,
-- and one deal can inform every plot of yours within reach of it.
CREATE TABLE IF NOT EXISTS property_comps (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lat        REAL    NOT NULL,
  lng        REAL    NOT NULL,
  area_m2    REAL    NOT NULL,
  -- The whole plot's price in VND, not per m² — it's the number a listing or a seller quotes.
  price      INTEGER NOT NULL,
  date       TEXT    NOT NULL,
  -- 'sale' (a price someone actually paid) or 'asking' (a listing). Asking prices are
  -- discounted on read, never on write, so the row keeps what you actually saw.
  kind       TEXT    NOT NULL DEFAULT 'asking',
  land_use   TEXT    NOT NULL DEFAULT 'residential',
  access     TEXT    NOT NULL DEFAULT 'alley',
  label      TEXT,
  source     TEXT,
  note       TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- An area price index per property: any consistent series for the area around it (say the
-- district's average asking ₫/m² from a listing site's price page). Only ratios between
-- two dates are ever used, so the unit doesn't matter — only that it stays the same.
CREATE TABLE IF NOT EXISTS property_index (
  instrument TEXT NOT NULL,
  date       TEXT NOT NULL,
  level      REAL NOT NULL,
  source     TEXT,
  PRIMARY KEY (instrument, date)
);
