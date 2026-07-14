/**
 * SQLite storage — the source of truth. Ported from the Flask version's db.py.
 * Amounts are whole VND integers (signed: + buy, − sell). Quantities/prices are floats.
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { Debt, DebtPayment, Goal, GoalContribution, Instrument, Payload, PriceSource, RecurringRule, Saving, Tx } from "./types";
import { fundCashAt, type GoalWorld } from "./goals";
import { currentValue, type Payment } from "./savings";

export { ASSET_TYPES, MANUAL_SOURCE } from "./types";
export type { AssetType, Debt, DebtPayment, Goal, GoalContribution, Instrument, Payload, PriceSource, RecurringRule, Saving, Tx } from "./types";

const SCHEMA = `
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
  updated_at    TEXT
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
`;

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const dbPath =
    process.env.DB_PATH ?? path.join(process.cwd(), "data", "investments.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.exec(SCHEMA);
  migrate(_db);
  seedPriceSources(_db);
  return _db;
}

/** The four price feeds ported from the Flask app, expressed as generic configs.
 *  INSERT OR IGNORE so existing DBs gain them and user edits are never clobbered. */
const BUILTIN_PRICE_SOURCES: PriceSource[] = [
  {
    key: "coingecko", label: "CoinGecko (crypto → VND)", kind: "json", method: "GET",
    url: "https://api.coingecko.com/api/v3/simple/price?ids={symbols}&vs_currencies=vnd",
    body: null, batch: 1, rows_path: "", key_field: null, price_field: "vnd",
    price_path: null, price_regex: null, history_strategy: "coingecko", builtin: 1, created_at: null,
  },
  {
    key: "yahoo", label: "Yahoo Finance (ticker)", kind: "json", method: "GET",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1d",
    body: null, batch: 0, rows_path: null, key_field: null, price_field: null,
    price_path: "chart.result.0.meta.regularMarketPrice", price_regex: null,
    history_strategy: "yahoo", builtin: 1, created_at: null,
  },
  {
    key: "fmarket", label: "fmarket.vn (fund NAV)", kind: "json", method: "POST",
    url: "https://api.fmarket.vn/res/products/filter",
    body: '{"types":["NEW_FUND","TRADING_FUND"],"page":1,"pageSize":100}',
    batch: 1, rows_path: "data.rows", key_field: "shortName", price_field: "nav",
    price_path: null, price_regex: null, history_strategy: "fmarket", builtin: 1, created_at: null,
  },
  {
    key: "vcbf", label: "VCBF-TBF (scraped)", kind: "html", method: "GET",
    url: "https://www.vcbf.com/quy-mo/cac-quy-mo/quy-dau-tu-can-bang-chien-luoc-vcbf/",
    body: null, batch: 0, rows_path: null, key_field: null, price_field: null,
    price_path: null, price_regex: '"tbf_data"\\s*:\\s*\\{.*?"price"\\s*:\\s*"([\\d.,]+)"',
    history_strategy: "fmarket", builtin: 1, created_at: null,
  },
];

function seedPriceSources(db: Database.Database) {
  // Seed exactly once. After that, built-ins are ordinary rows the user may delete —
  // re-seeding would resurrect them on every restart, so the flag guards against that.
  const seeded = db.prepare("SELECT 1 FROM meta WHERE key='price_sources_seeded'").get();
  if (seeded) return;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO price_sources
       (key, label, kind, method, url, body, batch, rows_path, key_field,
        price_field, price_path, price_regex, history_strategy, builtin, created_at)
     VALUES
       (@key, @label, @kind, @method, @url, @body, @batch, @rows_path, @key_field,
        @price_field, @price_path, @price_regex, @history_strategy, @builtin, @created_at)`,
  );
  const now = new Date().toISOString().slice(0, 19);
  for (const s of BUILTIN_PRICE_SOURCES) stmt.run({ ...s, created_at: now });
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('price_sources_seeded', ?)").run(now);
}

/** Idempotent column additions for tables that predate a new column. */
function migrate(db: Database.Database) {
  const hasColumn = (table: string, col: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
  if (!hasColumn("debts", "kind"))
    db.exec("ALTER TABLE debts ADD COLUMN kind TEXT NOT NULL DEFAULT 'fixed'");
  if (!hasColumn("debts", "monthly_payment"))
    db.exec("ALTER TABLE debts ADD COLUMN monthly_payment INTEGER");
  if (!hasColumn("savings", "goal_id"))
    db.exec("ALTER TABLE savings ADD COLUMN goal_id INTEGER");
  if (!hasColumn("goals", "position")) {
    db.exec("ALTER TABLE goals ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
    // Seed the ranking from the order goals were already listed in, so an existing board
    // doesn't reshuffle itself the first time it loads.
    db.exec("UPDATE goals SET position = id");
  }
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function nowIso(): string {
  return new Date().toISOString().slice(0, 19);
}

// ---------- transactions ----------

export function addTransaction(
  date: string, assetType: string, instrument: string,
  amount: number, quantity: number | null = null, note: string | null = null,
) {
  const db = getDb();
  db.prepare(
    "INSERT INTO transactions(date, asset_type, instrument, amount, quantity, note) VALUES (?,?,?,?,?,?)",
  ).run(date, assetType, instrument.trim(), Math.round(amount), quantity, note);
  ensureInstrument(instrument.trim(), assetType);
}

export function updateTransaction(
  id: number, date: string, assetType: string, instrument: string,
  amount: number, quantity: number | null, note: string | null,
) {
  const db = getDb();
  db.prepare(
    "UPDATE transactions SET date=?, asset_type=?, instrument=?, amount=?, quantity=?, note=? WHERE id=?",
  ).run(date, assetType, instrument.trim(), Math.round(amount), quantity, note, id);
  ensureInstrument(instrument.trim(), assetType);
}

export function deleteTransaction(id: number) {
  getDb().prepare("DELETE FROM transactions WHERE id=?").run(id);
}

export function getTransaction(id: number): Tx | undefined {
  return getDb().prepare("SELECT * FROM transactions WHERE id=?").get(id) as Tx | undefined;
}

export function allTransactions(): Tx[] {
  return getDb()
    .prepare("SELECT * FROM transactions ORDER BY date DESC, id DESC")
    .all() as Tx[];
}

// ---------- savings (term deposits) ----------

export function listSavings(): Saving[] {
  return getDb()
    .prepare("SELECT * FROM savings ORDER BY start_date DESC, id DESC")
    .all() as Saving[];
}

export function getSaving(id: number): Saving | undefined {
  return getDb().prepare("SELECT * FROM savings WHERE id=?").get(id) as Saving | undefined;
}

export function addSaving(
  bank: string | null, principal: number, rate: number, startDate: string,
  termMonths: number, interestType: string, goalId: number | null = null,
  note: string | null = null,
) {
  getDb()
    .prepare(
      "INSERT INTO savings(bank, principal, rate, start_date, term_months, interest_type, goal_id, note) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(bank, Math.round(principal), rate, startDate, Math.round(termMonths), interestType, goalId, note);
}

export function updateSaving(
  id: number, bank: string | null, principal: number, rate: number, startDate: string,
  termMonths: number, interestType: string, goalId: number | null, note: string | null,
) {
  getDb()
    .prepare(
      "UPDATE savings SET bank=?, principal=?, rate=?, start_date=?, term_months=?, interest_type=?, goal_id=?, note=? WHERE id=?",
    )
    .run(bank, Math.round(principal), rate, startDate, Math.round(termMonths), interestType, goalId, note, id);
}

export function deleteSaving(id: number) {
  getDb().prepare("DELETE FROM savings WHERE id=?").run(id);
}

// ---------- debts (loans) ----------

export function listDebts(): Debt[] {
  return getDb()
    .prepare("SELECT * FROM debts ORDER BY start_date DESC, id DESC")
    .all() as Debt[];
}

export function getDebt(id: number): Debt | undefined {
  return getDb().prepare("SELECT * FROM debts WHERE id=?").get(id) as Debt | undefined;
}

export function addDebt(
  lender: string | null, principal: number, rate: number, startDate: string,
  termMonths: number, interestType: string, kind: string,
  monthlyPayment: number | null, note: string | null = null,
) {
  getDb()
    .prepare(
      "INSERT INTO debts(lender, principal, rate, start_date, term_months, interest_type, kind, monthly_payment, note) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run(lender, Math.round(principal), rate, startDate, Math.round(termMonths), interestType, kind,
      monthlyPayment == null ? null : Math.round(monthlyPayment), note);
}

export function updateDebt(
  id: number, lender: string | null, principal: number, rate: number, startDate: string,
  termMonths: number, interestType: string, kind: string,
  monthlyPayment: number | null, note: string | null,
) {
  getDb()
    .prepare(
      "UPDATE debts SET lender=?, principal=?, rate=?, start_date=?, term_months=?, interest_type=?, kind=?, monthly_payment=?, note=? WHERE id=?",
    )
    .run(lender, Math.round(principal), rate, startDate, Math.round(termMonths), interestType, kind,
      monthlyPayment == null ? null : Math.round(monthlyPayment), note, id);
}

export function deleteDebt(id: number) {
  const db = getDb();
  db.prepare("DELETE FROM debt_payments WHERE debt_id=?").run(id);
  db.prepare("DELETE FROM debts WHERE id=?").run(id);
}

export function listDebtPayments(debtId?: number): DebtPayment[] {
  const db = getDb();
  if (debtId != null)
    return db.prepare("SELECT * FROM debt_payments WHERE debt_id=? ORDER BY date, id").all(debtId) as DebtPayment[];
  return db.prepare("SELECT * FROM debt_payments ORDER BY date, id").all() as DebtPayment[];
}

export function addDebtPayment(debtId: number, date: string, amount: number, note: string | null = null) {
  getDb()
    .prepare("INSERT INTO debt_payments(debt_id, date, amount, note) VALUES (?,?,?,?)")
    .run(debtId, date, Math.round(amount), note);
}

export function updateDebtPayment(
  id: number, date: string, amount: number, note: string | null = null,
): boolean {
  const info = getDb()
    .prepare("UPDATE debt_payments SET date=?, amount=?, note=? WHERE id=?")
    .run(date, Math.round(amount), note, id);
  return info.changes > 0;
}

export function deleteDebtPayment(id: number) {
  getDb().prepare("DELETE FROM debt_payments WHERE id=?").run(id);
}

// ---------- instruments ----------

export function ensureInstrument(name: string, assetType: string) {
  getDb()
    .prepare(
      "INSERT INTO instruments(name, asset_type, updated_at) VALUES (?,?,?) ON CONFLICT(name) DO NOTHING",
    )
    .run(name, assetType, nowIso());
}

/** Create a managed holding. Returns false if one with that name already exists. */
export function addInstrument(
  name: string, assetType: string, priceSource: string,
  symbol: string | null, quantity: number | null, manualValue: number | null,
): boolean {
  const info = getDb()
    .prepare(
      "INSERT INTO instruments(name, asset_type, price_source, symbol, quantity, manual_value, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(name) DO NOTHING",
    )
    .run(name.trim(), assetType, priceSource, symbol || null, quantity, manualValue, nowIso());
  return info.changes > 0;
}

export function listInstruments(): Instrument[] {
  return getDb()
    .prepare("SELECT * FROM instruments ORDER BY asset_type, name")
    .all() as Instrument[];
}

export function getInstrument(name: string): Instrument | undefined {
  return getDb().prepare("SELECT * FROM instruments WHERE name=?").get(name) as
    | Instrument
    | undefined;
}

export function instrumentNames(): string[] {
  return (getDb().prepare("SELECT name FROM instruments ORDER BY name").all() as { name: string }[])
    .map((r) => r.name);
}

export function updateInstrumentFields(
  name: string, assetType: string, priceSource: string,
  symbol: string | null, quantity: number | null, manualValue: number | null,
) {
  getDb()
    .prepare(
      "UPDATE instruments SET asset_type=?, price_source=?, symbol=?, quantity=?, manual_value=?, updated_at=? WHERE name=?",
    )
    .run(assetType, priceSource, symbol || null, quantity, manualValue, nowIso(), name);
}

export function updatePrice(name: string, price: number) {
  getDb()
    .prepare("UPDATE instruments SET last_price=?, last_price_at=? WHERE name=?")
    .run(price, nowIso(), name);
}

export function holdingValue(row: Instrument): number {
  if (row.quantity != null && row.last_price != null)
    return Math.round(row.quantity * row.last_price);
  return row.manual_value ?? 0;
}

/** True if any transaction or recurring rule references this holding. */
export function instrumentInUse(name: string): boolean {
  const db = getDb();
  const tx = db.prepare("SELECT 1 FROM transactions WHERE instrument=? LIMIT 1").get(name);
  const rule = db.prepare("SELECT 1 FROM recurring_rules WHERE instrument=? LIMIT 1").get(name);
  return Boolean(tx || rule);
}

export function deleteInstrument(name: string) {
  getDb().prepare("DELETE FROM instruments WHERE name=?").run(name);
}

// ---------- recurring rules (auto-DCA) ----------

export function addRecurring(
  instrument: string, assetType: string, amount: number,
  freq: string, startDate: string, note: string | null,
) {
  getDb()
    .prepare(
      "INSERT INTO recurring_rules(instrument, asset_type, amount, freq, start_date, note) VALUES (?,?,?,?,?,?)",
    )
    .run(instrument.trim(), assetType, Math.round(amount), freq, startDate, note);
  ensureInstrument(instrument.trim(), assetType);
}

export function updateRecurring(
  id: number, instrument: string, assetType: string, amount: number,
  freq: string, startDate: string, note: string | null,
) {
  getDb()
    .prepare(
      "UPDATE recurring_rules SET instrument=?, asset_type=?, amount=?, freq=?, start_date=?, note=? WHERE id=?",
    )
    .run(instrument.trim(), assetType, Math.round(amount), freq, startDate, note, id);
  ensureInstrument(instrument.trim(), assetType);
}

export function listRecurring(): RecurringRule[] {
  return getDb()
    .prepare("SELECT * FROM recurring_rules ORDER BY active DESC, instrument")
    .all() as RecurringRule[];
}

export function toggleRecurring(id: number) {
  getDb().prepare("UPDATE recurring_rules SET active = 1 - active WHERE id=?").run(id);
}

export function deleteRecurring(id: number) {
  getDb().prepare("DELETE FROM recurring_rules WHERE id=?").run(id);
}

function* occurrences(
  freq: string, start: Date, after: Date | null, until: Date,
): Generator<Date> {
  if (freq === "weekly") {
    let d = new Date(start);
    if (after && after >= start) {
      const k = Math.floor((after.getTime() - start.getTime()) / 86400000 / 7) + 1;
      d = new Date(start.getTime() + k * 7 * 86400000);
    }
    while (d <= until) {
      yield new Date(d);
      d = new Date(d.getTime() + 7 * 86400000);
    }
  } else {
    let year = start.getFullYear();
    let month = start.getMonth();
    for (;;) {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const occ = new Date(year, month, Math.min(start.getDate(), daysInMonth));
      if (occ > until) break;
      if (occ >= start && (!after || occ > after)) yield occ;
      month += 1;
      if (month === 12) { month = 0; year += 1; }
    }
  }
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateOf(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Insert due transactions for active rules. Idempotent; called on page load. */
export function materializeRecurring(): number {
  const db = getDb();
  const today = dateOf(todayIso());
  let inserted = 0;
  const rules = db
    .prepare("SELECT * FROM recurring_rules WHERE active=1")
    .all() as RecurringRule[];
  for (const rule of rules) {
    const start = dateOf(rule.start_date);
    const after = rule.last_run ? dateOf(rule.last_run) : null;
    let last: Date | null = null;
    for (const occ of occurrences(rule.freq, start, after, today)) {
      addTransaction(isoOf(occ), rule.asset_type, rule.instrument, rule.amount,
        null, rule.note ?? "Auto-DCA");
      last = occ;
      inserted += 1;
    }
    if (last)
      db.prepare("UPDATE recurring_rules SET last_run=? WHERE id=?")
        .run(isoOf(last), rule.id);
  }
  return inserted;
}

export function ruleNextDue(rule: RecurringRule): string | null {
  const start = dateOf(rule.start_date);
  const after = rule.last_run ? dateOf(rule.last_run) : null;
  const horizon = new Date(Date.now() + 800 * 86400000);
  for (const occ of occurrences(rule.freq, start, after, horizon)) return isoOf(occ);
  return null;
}

// ---------- pending fund units (T+1 / T+2 business days) ----------

export function pendingFundUnits(days = 14): Tx[] {
  const cutoff = isoOf(new Date(Date.now() - days * 86400000));
  return getDb()
    .prepare(
      // amount > 0 only: a sale isn't "awaiting units", and confirming one would
      // add units to the holding rather than remove them.
      "SELECT * FROM transactions WHERE asset_type='Funds' AND quantity IS NULL AND amount > 0 AND date >= ? ORDER BY date DESC, id DESC",
    )
    .all(cutoff) as Tx[];
}

export function addBusinessDays(iso: string, n: number): Date {
  const d = dateOf(iso);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left -= 1;
  }
  return d;
}

/** Confirmation window: T+1 business day (before 2pm) to T+2 (after 2pm). */
export function expectedUnitsWindow(purchaseDate: string): [string, string] {
  return [isoOf(addBusinessDays(purchaseDate, 1)), isoOf(addBusinessDays(purchaseDate, 2))];
}

export function setTransactionQuantity(
  id: number, quantity: number, addToHoldings: boolean,
): boolean {
  const db = getDb();
  const tx = getTransaction(id);
  if (!tx) return false;
  db.prepare("UPDATE transactions SET quantity=? WHERE id=?").run(quantity, id);
  if (addToHoldings) {
    const inst = getInstrument(tx.instrument);
    if (inst && inst.quantity != null)
      db.prepare("UPDATE instruments SET quantity = quantity + ?, updated_at=? WHERE name=?")
        .run(quantity, nowIso(), tx.instrument);
  }
  return true;
}

// ---------- price sources (user-defined price feeds) ----------

const PRICE_SOURCE_COLS =
  "key, label, kind, method, url, body, batch, rows_path, key_field, price_field, price_path, price_regex, history_strategy, builtin, created_at";

export function listPriceSources(): PriceSource[] {
  return getDb()
    .prepare(`SELECT ${PRICE_SOURCE_COLS} FROM price_sources ORDER BY builtin DESC, key`)
    .all() as PriceSource[];
}

export function getPriceSource(key: string): PriceSource | undefined {
  return getDb()
    .prepare(`SELECT ${PRICE_SOURCE_COLS} FROM price_sources WHERE key=?`)
    .get(key) as PriceSource | undefined;
}

/** Upsert a price source. `builtin` is never changed on an existing row. */
export function savePriceSource(s: Omit<PriceSource, "created_at">): void {
  getDb()
    .prepare(
      `INSERT INTO price_sources
         (key, label, kind, method, url, body, batch, rows_path, key_field,
          price_field, price_path, price_regex, history_strategy, builtin, created_at)
       VALUES
         (@key, @label, @kind, @method, @url, @body, @batch, @rows_path, @key_field,
          @price_field, @price_path, @price_regex, @history_strategy, @builtin, @created_at)
       ON CONFLICT(key) DO UPDATE SET
         label=@label, kind=@kind, method=@method, url=@url, body=@body, batch=@batch,
         rows_path=@rows_path, key_field=@key_field, price_field=@price_field,
         price_path=@price_path, price_regex=@price_regex, history_strategy=@history_strategy`,
    )
    .run({ ...s, created_at: nowIso() });
}

/** True if any instrument currently uses this source key. */
export function priceSourceInUse(key: string): boolean {
  return Boolean(
    getDb().prepare("SELECT 1 FROM instruments WHERE price_source=? LIMIT 1").get(key),
  );
}

export function deletePriceSource(key: string): void {
  getDb().prepare("DELETE FROM price_sources WHERE key=?").run(key);
}

// ---------- price history + meta ----------

export function upsertPriceHistory(instrument: string, map: Record<string, number>) {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO price_history(instrument, date, price) VALUES (?,?,?)",
  );
  const run = db.transaction(() => {
    for (const [date, price] of Object.entries(map)) if (price) stmt.run(instrument, date, price);
  });
  run();
}

export function priceHistoryByInstrument(): Record<string, [string, number][]> {
  const rows = getDb()
    .prepare("SELECT instrument, date, price FROM price_history ORDER BY instrument, date")
    .all() as { instrument: string; date: string; price: number }[];
  const out: Record<string, [string, number][]> = {};
  for (const r of rows) (out[r.instrument] ??= []).push([r.date, r.price]);
  return out;
}

export function metaGet(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM meta WHERE key=?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function metaSet(key: string, value: string) {
  getDb().prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?,?)").run(key, value);
}

// ---------- goals ----------

/** Ranked order: you decide it (`position`), so it wins over any date or metric. */
export function listGoals(includeArchived = false): Goal[] {
  const where = includeArchived ? "" : "WHERE archived = 0";
  return getDb()
    .prepare(`SELECT * FROM goals ${where} ORDER BY archived, position, id`)
    .all() as Goal[];
}

export function getGoal(id: number): Goal | undefined {
  return getDb().prepare("SELECT * FROM goals WHERE id=?").get(id) as Goal | undefined;
}

export function addGoal(
  name: string, metric: string, target: number, baseline: number,
  monthlyPlan: number | null, targetDate: string | null, note: string | null = null,
) {
  const db = getDb();
  // New goals land at the bottom of the ranking — a fresh goal shouldn't quietly outrank
  // the ones you've already thought about.
  const last = (db.prepare("SELECT COALESCE(MAX(position), 0) p FROM goals").get() as { p: number }).p;
  db.prepare(
    "INSERT INTO goals(name, metric, target, baseline, monthly_plan, target_date, position, note) VALUES (?,?,?,?,?,?,?,?)",
  ).run(name.trim(), metric, Math.round(target), Math.round(baseline),
    monthlyPlan == null ? null : Math.round(monthlyPlan), targetDate, last + 1, note);
}

export function updateGoal(
  id: number, name: string, metric: string, target: number, baseline: number,
  monthlyPlan: number | null, targetDate: string | null, note: string | null,
) {
  getDb()
    .prepare(
      "UPDATE goals SET name=?, metric=?, target=?, baseline=?, monthly_plan=?, target_date=?, note=? WHERE id=?",
    )
    .run(name.trim(), metric, Math.round(target), Math.round(baseline),
      monthlyPlan == null ? null : Math.round(monthlyPlan), targetDate, note, id);
}

/**
 * Move a goal one place up or down the ranking, by swapping positions with its neighbour.
 *
 * The swap is done among goals in the same archived state — an active goal steps over the
 * active goal above it, never over an archived one it can't even see. Returns false when
 * there's no neighbour to swap with (already top or bottom), so the UI can say nothing
 * happened rather than toast a lie.
 */
export function moveGoal(id: number, direction: "up" | "down"): boolean {
  const db = getDb();
  const goal = getGoal(id);
  if (!goal) return false;

  const neighbour = db
    .prepare(
      direction === "up"
        ? `SELECT id, position FROM goals WHERE archived = ? AND (position < ? OR (position = ? AND id < ?))
           ORDER BY position DESC, id DESC LIMIT 1`
        : `SELECT id, position FROM goals WHERE archived = ? AND (position > ? OR (position = ? AND id > ?))
           ORDER BY position ASC, id ASC LIMIT 1`,
    )
    .get(goal.archived, goal.position, goal.position, id) as
    | { id: number; position: number }
    | undefined;
  if (!neighbour) return false;

  // Ties are possible (a DB seeded before positions existed, say), and swapping equal
  // positions would be a no-op that silently does nothing — so re-rank by index instead.
  const swap = db.transaction(() => {
    const set = db.prepare("UPDATE goals SET position = ? WHERE id = ?");
    if (goal.position === neighbour.position) {
      set.run(direction === "up" ? goal.position - 1 : goal.position + 1, id);
    } else {
      set.run(neighbour.position, id);
      set.run(goal.position, neighbour.id);
    }
  });
  swap();
  return true;
}

export function setGoalArchived(id: number, archived: boolean) {
  getDb().prepare("UPDATE goals SET archived=? WHERE id=?").run(archived ? 1 : 0, id);
}

export function deleteGoal(id: number) {
  const db = getDb();
  db.prepare("DELETE FROM goal_contributions WHERE goal_id=?").run(id);
  // Un-earmark, don't delete: the deposits are real money and outlive the goal.
  db.prepare("UPDATE savings SET goal_id=NULL WHERE goal_id=?").run(id);
  db.prepare("DELETE FROM goals WHERE id=?").run(id);
}

/** Release every deposit earmarked for a goal, leaving the deposits themselves untouched. */
export function unlinkGoalSavings(goalId: number) {
  getDb().prepare("UPDATE savings SET goal_id=NULL WHERE goal_id=?").run(goalId);
}

/** Deposits earmarked for a sinking fund, keyed by goal id. */
export function savingsByGoal(): Record<number, Saving[]> {
  const byGoal: Record<number, Saving[]> = {};
  for (const s of listSavings()) {
    if (s.goal_id != null) (byGoal[s.goal_id] ??= []).push(s);
  }
  return byGoal;
}

// ---------- sinking-fund contributions ----------

/** Every contribution, or just one goal's. Oldest first, so a ledger reads top-down. */
export function listGoalContributions(goalId?: number): GoalContribution[] {
  const db = getDb();
  return goalId == null
    ? (db.prepare("SELECT * FROM goal_contributions ORDER BY date, id").all() as GoalContribution[])
    : (db
        .prepare("SELECT * FROM goal_contributions WHERE goal_id=? ORDER BY date, id")
        .all(goalId) as GoalContribution[]);
}

export function addGoalContribution(
  goalId: number, date: string, amount: number, note: string | null = null,
) {
  getDb()
    .prepare("INSERT INTO goal_contributions(goal_id, date, amount, note) VALUES (?,?,?,?)")
    .run(goalId, date, Math.round(amount), note);
}

export function deleteGoalContribution(id: number) {
  getDb().prepare("DELETE FROM goal_contributions WHERE id=?").run(id);
}

/** The *cash* a fund holds right now — the ledger only, not its earmarked deposits. */
export function fundCash(goalId: number, today = new Date()): number {
  return fundCashAt(listGoalContributions(goalId), today);
}

/**
 * Everything a fund is worth: cash set aside, plus the live value of the deposits
 * earmarked for it (each with its own rate and term — see `Saving.goal_id`).
 */
export function fundValue(goalId: number, today = new Date()): number {
  const deposits = (savingsByGoal()[goalId] ?? []).reduce(
    (a, s) => a + currentValue(s, today),
    0,
  );
  return fundCash(goalId, today) + deposits;
}

/**
 * Cash set aside across every sinking fund — net worth's extra line.
 *
 * Deposits are deliberately NOT in here: an earmarked deposit is already counted under
 * Savings, and adding it again would inflate net worth by the same money twice. Only the
 * un-deposited cash is new. Archived funds still count — "mark as bought" drains the pot,
 * so anything left in one is money you still hold, watched or not.
 */
export function fundsCashTotal(today = new Date()): number {
  const goals = getDb()
    .prepare("SELECT id FROM goals WHERE metric='fund'")
    .all() as { id: number }[];
  return goals.reduce((a, g) => a + fundCash(g.id, today), 0);
}

/** ₫/month you've committed to via active recurring rules — the *forward* contribution
 *  rate, which is what a projection actually wants (a trailing average only looks back). */
export function plannedMonthly(): number {
  const rules = getDb()
    .prepare("SELECT amount, freq FROM recurring_rules WHERE active=1")
    .all() as { amount: number; freq: string }[];
  return rules.reduce((a, r) => a + (r.freq === "weekly" ? (r.amount * 52) / 12 : r.amount), 0);
}

/** ₫/month actually contributed over the trailing window — the fallback pace when there
 *  are no recurring rules. Net of sells, floored at 0. */
export function actualMonthly(months = 6): number {
  const since = addMonthsIso(todayIso(), -months);
  const total = (getDb()
    .prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE date >= ?")
    .get(since) as { s: number }).s;
  return Math.max(0, total / months);
}

function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d, lastDay));
  return base.toISOString().slice(0, 10);
}

/** Gathers everything `lib/goals.ts` needs to project a goal forward. */
export function buildGoalWorld(investments: number): GoalWorld {
  const paymentsByDebt: Record<number, Payment[]> = {};
  for (const p of listDebtPayments()) (paymentsByDebt[p.debt_id] ??= []).push(p);

  const contributions: Record<number, GoalContribution[]> = {};
  for (const c of listGoalContributions()) (contributions[c.goal_id] ??= []).push(c);

  // Every fund, archived included — see `fundsCashTotal`. Net worth has to see the money
  // even when the goal watching it has been put away.
  const funds = getDb()
    .prepare("SELECT id FROM goals WHERE metric='fund'")
    .all() as { id: number }[];

  return {
    today: todayIso(),
    nowMs: Date.now(),
    investments,
    savings: listSavings(),
    debts: listDebts(),
    paymentsByDebt,
    funds,
    contributions,
    savingsByGoal: savingsByGoal(),
    plannedMonthly: plannedMonthly(),
    actualMonthly: actualMonthly(),
  };
}

// ---------- dashboard payload ----------

export function buildPayload(): Payload {
  const db = getDb();
  const txRows = db
    .prepare("SELECT date, asset_type, amount FROM transactions ORDER BY date, id")
    .all() as { date: string; asset_type: string; amount: number }[];

  const costByInstrument: Record<string, number> = {};
  for (const r of db
    .prepare("SELECT instrument, SUM(amount) c FROM transactions GROUP BY instrument")
    .all() as { instrument: string; c: number }[])
    costByInstrument[r.instrument] = r.c;

  const portfolio: Payload["portfolio"] = [];
  for (const row of listInstruments()) {
    const value = holdingValue(row);
    if (!value) continue;
    const cost = costByInstrument[row.name] ?? 0;
    portfolio.push({
      name: row.name, value, type: row.asset_type,
      live: row.quantity != null && row.last_price != null,
      cost, pnl: value - cost,
    });
  }
  portfolio.sort((a, b) => b.value - a.value);

  const investedTotal = (db
    .prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions")
    .get() as { s: number }).s;
  const portfolioTotal = portfolio.reduce((a, p) => a + p.value, 0);

  const alloc: Record<string, number> = {};
  for (const p of portfolio) alloc[p.type] = (alloc[p.type] ?? 0) + p.value;

  const pricesAsOf = (getDb()
    .prepare("SELECT MAX(last_price_at) m FROM instruments")
    .get() as { m: string | null }).m;

  return {
    contributions: txRows, portfolio, portfolioTotal, investedTotal,
    pnl: portfolioTotal - investedTotal,
    allocation: Object.entries(alloc)
      .map(([type, value]) => ({ type, value }))
      .sort((a, b) => b.value - a.value),
    pricesAsOf,
    generated: new Date().toLocaleString("sv-SE").slice(0, 16),
  };
}
