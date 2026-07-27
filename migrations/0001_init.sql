-- Initial schema. Transcribed from the `SCHEMA` string that used to live in lib/db.ts and
-- run on every boot via `CREATE TABLE IF NOT EXISTS`.
--
-- That auto-migrating trick is gone: D1 has real migration files, so adding a table now
-- means adding a numbered file here rather than editing a string. The column set below is
-- the *post-migrate()* shape — debts.kind, debts.monthly_payment, savings.goal_id,
-- instruments.archived and goals.position were all added by the old ALTER TABLE ladder and
-- are simply part of the schema from the start here.

CREATE TABLE IF NOT EXISTS transactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT    NOT NULL,
  asset_type TEXT    NOT NULL,
  instrument TEXT    NOT NULL,
  amount     INTEGER NOT NULL,
  quantity   REAL,
  note       TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);

CREATE TABLE IF NOT EXISTS instruments (
  name          TEXT PRIMARY KEY,
  asset_type    TEXT NOT NULL,
  price_source  TEXT NOT NULL DEFAULT 'manual',
  symbol        TEXT,
  quantity      REAL,
  manual_value  INTEGER,
  last_price    REAL,
  last_price_at TEXT,
  updated_at    TEXT,
  archived      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS recurring_rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument TEXT    NOT NULL,
  asset_type TEXT    NOT NULL,
  amount     INTEGER NOT NULL,
  freq       TEXT    NOT NULL,
  start_date TEXT    NOT NULL,
  last_run   TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  note       TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS price_history (
  instrument TEXT NOT NULL,
  date       TEXT NOT NULL,
  price      REAL NOT NULL,
  PRIMARY KEY (instrument, date)
);

CREATE TABLE IF NOT EXISTS savings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bank          TEXT,
  principal     INTEGER NOT NULL,
  rate          REAL    NOT NULL,
  start_date    TEXT    NOT NULL,
  term_months   INTEGER NOT NULL,
  interest_type TEXT    NOT NULL DEFAULT 'simple',
  goal_id       INTEGER,
  note          TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS debts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  lender          TEXT,
  principal       INTEGER NOT NULL,
  rate            REAL    NOT NULL,
  start_date      TEXT    NOT NULL,
  term_months     INTEGER NOT NULL,
  interest_type   TEXT    NOT NULL DEFAULT 'simple',
  kind            TEXT    NOT NULL DEFAULT 'fixed',
  monthly_payment INTEGER,
  note            TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS debt_payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id    INTEGER NOT NULL,
  date       TEXT    NOT NULL,
  amount     INTEGER NOT NULL,
  note       TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_debt_payments_debt ON debt_payments(debt_id);

CREATE TABLE IF NOT EXISTS goals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  metric       TEXT    NOT NULL,
  target       INTEGER NOT NULL,
  baseline     INTEGER NOT NULL DEFAULT 0,
  monthly_plan INTEGER,
  target_date  TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  archived     INTEGER NOT NULL DEFAULT 0,
  note         TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Contributions to a sinking-fund goal (metric = 'fund'). Negative = a withdrawal.
CREATE TABLE IF NOT EXISTS goal_contributions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id    INTEGER NOT NULL,
  date       TEXT    NOT NULL,
  amount     INTEGER NOT NULL,
  note       TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_goal_contributions_goal ON goal_contributions(goal_id);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS price_sources (
  key              TEXT PRIMARY KEY,
  label            TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'json',
  method           TEXT NOT NULL DEFAULT 'GET',
  url              TEXT NOT NULL,
  body             TEXT,
  batch            INTEGER NOT NULL DEFAULT 0,
  rows_path        TEXT,
  key_field        TEXT,
  price_field      TEXT,
  price_path       TEXT,
  price_regex      TEXT,
  history_strategy TEXT NOT NULL DEFAULT 'none',
  builtin          INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT
);
