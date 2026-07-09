/**
 * SQLite storage — the source of truth. Ported from the Flask version's db.py.
 * Amounts are whole VND integers (signed: + buy, − sell). Quantities/prices are floats.
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { Debt, Instrument, Payload, RecurringRule, Saving, Tx } from "./types";

export { ASSET_TYPES, PRICE_SOURCES } from "./types";
export type { AssetType, Debt, Instrument, Payload, RecurringRule, Saving, Tx } from "./types";

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
  note          TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS debts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lender        TEXT,
  principal     INTEGER NOT NULL,
  rate          REAL    NOT NULL,
  start_date    TEXT    NOT NULL,
  term_months   INTEGER NOT NULL,
  interest_type TEXT    NOT NULL DEFAULT 'simple',
  note          TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
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
  return _db;
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
  termMonths: number, interestType: string, note: string | null = null,
) {
  getDb()
    .prepare(
      "INSERT INTO savings(bank, principal, rate, start_date, term_months, interest_type, note) VALUES (?,?,?,?,?,?,?)",
    )
    .run(bank, Math.round(principal), rate, startDate, Math.round(termMonths), interestType, note);
}

export function updateSaving(
  id: number, bank: string | null, principal: number, rate: number, startDate: string,
  termMonths: number, interestType: string, note: string | null,
) {
  getDb()
    .prepare(
      "UPDATE savings SET bank=?, principal=?, rate=?, start_date=?, term_months=?, interest_type=?, note=? WHERE id=?",
    )
    .run(bank, Math.round(principal), rate, startDate, Math.round(termMonths), interestType, note, id);
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
  termMonths: number, interestType: string, note: string | null = null,
) {
  getDb()
    .prepare(
      "INSERT INTO debts(lender, principal, rate, start_date, term_months, interest_type, note) VALUES (?,?,?,?,?,?,?)",
    )
    .run(lender, Math.round(principal), rate, startDate, Math.round(termMonths), interestType, note);
}

export function updateDebt(
  id: number, lender: string | null, principal: number, rate: number, startDate: string,
  termMonths: number, interestType: string, note: string | null,
) {
  getDb()
    .prepare(
      "UPDATE debts SET lender=?, principal=?, rate=?, start_date=?, term_months=?, interest_type=?, note=? WHERE id=?",
    )
    .run(lender, Math.round(principal), rate, startDate, Math.round(termMonths), interestType, note, id);
}

export function deleteDebt(id: number) {
  getDb().prepare("DELETE FROM debts WHERE id=?").run(id);
}

// ---------- instruments ----------

export function ensureInstrument(name: string, assetType: string) {
  getDb()
    .prepare(
      "INSERT INTO instruments(name, asset_type, updated_at) VALUES (?,?,?) ON CONFLICT(name) DO NOTHING",
    )
    .run(name, assetType, nowIso());
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
      "SELECT * FROM transactions WHERE asset_type='Funds' AND quantity IS NULL AND date >= ? ORDER BY date DESC, id DESC",
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
