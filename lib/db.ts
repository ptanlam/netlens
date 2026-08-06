/**
 * D1 storage — the source of truth. Amounts are whole VND integers (signed: + buy, − sell).
 * Quantities/prices are floats.
 *
 * Ported from better-sqlite3, which could not run on Workers (a native addon reading a file
 * off disk). Three consequences worth knowing before you edit anything here:
 *
 * 1. **Every function is async.** D1 has no synchronous API. The pure maths in `goals.ts` /
 *    `savings.ts` is untouched — this module depends on those, never the reverse, so the
 *    async only ever spreads *outward* into pages and actions, where `await` is free.
 * 2. **Positional parameters only.** D1 does not support better-sqlite3's `@named` binding,
 *    so the two statements that used it (price-source upsert, and the old seed) are now
 *    plain `?` lists. Keep the column order and the value order in step.
 * 3. **No interactive transactions.** `db.transaction(() => …)` is gone; D1 offers
 *    `batch()`, which runs an array of statements atomically but can't branch mid-way. Both
 *    former transactions are expressed as batches below.
 *
 * The schema lives in `migrations/`, not in a string here — see `migrations/0001_init.sql`.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Debt, DebtPayment, Goal, GoalContribution, Instrument, LivePayload, Payload, PriceSource, RecurringRule, Saving, Tx } from "./types";
import { fundCashAt, type GoalWorld } from "./goals";
import { currentValue, type Payment } from "./savings";

export { ASSET_TYPES, MANUAL_SOURCE } from "./types";
export type { AssetType, Debt, DebtPayment, Goal, GoalContribution, Instrument, LivePayload, Payload, PriceSource, RecurringRule, Saving, Tx } from "./types";

/** Set by `bindD1`, for callers that have no Cloudflare context to read. */
let boundDb: D1Database | null = null;

/**
 * Hand this module a D1 binding directly.
 *
 * `getCloudflareContext()` reads a global that the adapter publishes while handling a
 * *fetch* invocation. A Cron Trigger is not one: `scheduled` never passes through the
 * adapter, so the global is unset and every query below throws before the cron can do
 * anything at all. The scheduled handler has `env` in hand, so it just says so.
 *
 * (Not named `useD1`: the React Compiler lint reads a `use` prefix as a hook.)
 */
export function bindD1(binding: D1Database) {
  boundDb = binding;
}

/** The D1 binding declared in wrangler.jsonc. */
function db(): D1Database {
  return boundDb ?? getCloudflareContext().env.DB;
}

type Bind = string | number | boolean | null;

/**
 * A better-sqlite3-shaped wrapper over a D1 prepared statement, so the call sites below read
 * the way they always did apart from the `await`. `first()` returns `null` on a miss where
 * better-sqlite3 returned `undefined`; normalised here so callers can keep using `?.` and
 * `if (!row)` without caring which engine they're on.
 */
function q(sql: string) {
  const stmt = (args: Bind[]) => (args.length ? db().prepare(sql).bind(...args) : db().prepare(sql));
  return {
    async get<T>(...args: Bind[]): Promise<T | undefined> {
      return ((await stmt(args).first()) as T | null) ?? undefined;
    },
    async all<T>(...args: Bind[]): Promise<T[]> {
      return (await stmt(args).all<T>()).results;
    },
    /** Resolves to D1's `meta` — `changes` and `last_row_id` live there. */
    async run(...args: Bind[]) {
      return (await stmt(args).run()).meta;
    },
    /** The raw statement, for feeding `db().batch([...])`. */
    bound(...args: Bind[]) {
      return stmt(args);
    },
  };
}

/** Decimal places a holding's unit count is kept to. Eight covers a satoshi (1e-8) — the
 *  finest unit anything here is quoted in — while sitting far above the ~1e-13 noise that
 *  double addition introduces, so rounding here can only remove error, never real data. */
const UNIT_DP = 8;

/** Normalise a unit count on the way in, so every path that writes `quantity` — hand-typed
 *  or accumulated — lands on the same grid and the invariant holds for the whole column. */
function roundUnits(v: number | null): number | null {
  if (v == null) return null;
  const f = 10 ** UNIT_DP;
  return Math.round(v * f) / f;
}

/** The calendar this app keeps its books in. Stated outright rather than taken from the
 *  runtime, because the runtime has no useful answer: workerd has no local timezone (its
 *  `Date` is UTC, and wrangler's `vars.TZ` does not change that — it is a plain env var),
 *  while `pnpm dev` picks up whatever the developer's machine is set to. */
export const APP_TIMEZONE = "Asia/Ho_Chi_Minh";

/** en-CA formats as YYYY-MM-DD, so no reassembly is needed. Built once — constructing an
 *  Intl formatter is expensive relative to how often `todayIso` is called. */
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today, in the user's timezone — the day boundary every stored date is keyed to.
 *
 *  This used to read local time, which in production meant UTC: for the first seven hours
 *  of every Vietnamese day the dashboard's "today" was actually yesterday, and the
 *  five-minute price cron stamped that morning's price into `price_history` over
 *  *yesterday's* settled close, moving a day's P&L onto the wrong day. */
export function todayIso(): string {
  return dayFormatter.format(new Date());
}

/**
 * The instant a request is being rendered at.
 *
 * Exists so a server page can fix one timestamp and hand it to the client components below
 * it, instead of each of them reading its own clock. Interest on deposits and debts accrues
 * by the second, so a client component that calls `new Date()` during render computes a
 * figure a rounding step away from the server's and React reports a hydration mismatch.
 * `buildGoalWorld` has always done this for `GoalWorld.nowMs`; Savings and Debts now do too.
 *
 * It lives here rather than being inlined in the page because the React Compiler's
 * `react-hooks/purity` rule — correctly — refuses a `Date.now()` call during a component's
 * render. Reading the clock is a data concern, and this module is where the other one
 * (`todayIso`) already lives.
 */
export function nowMs(): number {
  return Date.now();
}

function nowIso(): string {
  return new Date().toISOString().slice(0, 19);
}

// ---------- transactions ----------

/** Roll a signed unit delta into a holding's running total. `quantity` is already
 *  signed (a sale is negative), so a buy grows the holding and a sell shrinks it.
 *  COALESCE lets a brand-new holding start accumulating from a null quantity.
 *
 *  Rounded on every write, because this is a *running* total in IEEE-754 doubles and the
 *  error compounds: 1237.9 + 26.45 is 1264.3500000000001, and the next buy builds on that.
 *  Valuation never noticed (it rounds to whole VND), but the noise is stored, so it leaked
 *  into anything showing units — including the edit form, which would then save it back. */
async function adjustHoldingQuantity(instrument: string, delta: number) {
  if (delta === 0) return;
  await q(
    `UPDATE instruments SET quantity = ROUND(COALESCE(quantity, 0) + ?, ${UNIT_DP}), updated_at=? WHERE name=?`,
  ).run(delta, nowIso(), instrument.trim());
}

export async function addTransaction(
  date: string, assetType: string, instrument: string,
  amount: number, quantity: number | null = null, note: string | null = null,
) {
  await q(
    "INSERT INTO transactions(date, asset_type, instrument, amount, quantity, note) VALUES (?,?,?,?,?,?)",
  ).run(date, assetType, instrument.trim(), Math.round(amount), quantity, note);
  await ensureInstrument(instrument.trim(), assetType);
  if (quantity != null) await adjustHoldingQuantity(instrument, quantity);
}

export async function updateTransaction(
  id: number, date: string, assetType: string, instrument: string,
  amount: number, quantity: number | null, note: string | null,
) {
  // Read the prior row first so we can move units between holdings and net the delta.
  const prev = await getTransaction(id);
  await q(
    "UPDATE transactions SET date=?, asset_type=?, instrument=?, amount=?, quantity=?, note=? WHERE id=?",
  ).run(date, assetType, instrument.trim(), Math.round(amount), quantity, note, id);
  await ensureInstrument(instrument.trim(), assetType);
  if (prev) {
    const sameHolding = prev.instrument.trim() === instrument.trim();
    if (sameHolding) {
      await adjustHoldingQuantity(instrument, (quantity ?? 0) - (prev.quantity ?? 0));
    } else {
      // Instrument changed: pull the old units out of the old holding, add to the new.
      if (prev.quantity != null) await adjustHoldingQuantity(prev.instrument, -prev.quantity);
      if (quantity != null) await adjustHoldingQuantity(instrument, quantity);
    }
  }
}

export async function deleteTransaction(id: number) {
  const tx = await getTransaction(id);
  await q("DELETE FROM transactions WHERE id=?").run(id);
  if (tx?.quantity != null) await adjustHoldingQuantity(tx.instrument, -tx.quantity);
}

export async function getTransaction(id: number): Promise<Tx | undefined> {
  return q("SELECT * FROM transactions WHERE id=?").get<Tx>(id);
}

export async function allTransactions(): Promise<Tx[]> {
  return q("SELECT * FROM transactions ORDER BY date DESC, id DESC").all<Tx>();
}

// ---------- savings (term deposits) ----------

export async function listSavings(): Promise<Saving[]> {
  return q("SELECT * FROM savings ORDER BY start_date DESC, id DESC").all<Saving>();
}

export async function getSaving(id: number): Promise<Saving | undefined> {
  return q("SELECT * FROM savings WHERE id=?").get<Saving>(id);
}

export async function addSaving(
  bank: string | null, principal: number, rate: number, startDate: string,
  termMonths: number, interestType: string, goalId: number | null = null,
  note: string | null = null,
) {
  await q(
    "INSERT INTO savings(bank, principal, rate, start_date, term_months, interest_type, goal_id, note) VALUES (?,?,?,?,?,?,?,?)",
  ).run(bank, Math.round(principal), rate, startDate, Math.round(termMonths), interestType, goalId, note);
}

export async function updateSaving(
  id: number, bank: string | null, principal: number, rate: number, startDate: string,
  termMonths: number, interestType: string, goalId: number | null, note: string | null,
) {
  await q(
    "UPDATE savings SET bank=?, principal=?, rate=?, start_date=?, term_months=?, interest_type=?, goal_id=?, note=? WHERE id=?",
  ).run(bank, Math.round(principal), rate, startDate, Math.round(termMonths), interestType, goalId, note, id);
}

export async function deleteSaving(id: number) {
  await q("DELETE FROM savings WHERE id=?").run(id);
}

// ---------- debts (loans) ----------

export async function listDebts(): Promise<Debt[]> {
  return q("SELECT * FROM debts ORDER BY start_date DESC, id DESC").all<Debt>();
}

export async function getDebt(id: number): Promise<Debt | undefined> {
  return q("SELECT * FROM debts WHERE id=?").get<Debt>(id);
}

export async function addDebt(
  lender: string | null, principal: number, rate: number, startDate: string,
  termMonths: number, interestType: string, kind: string,
  monthlyPayment: number | null, note: string | null = null,
) {
  await q(
    "INSERT INTO debts(lender, principal, rate, start_date, term_months, interest_type, kind, monthly_payment, note) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(lender, Math.round(principal), rate, startDate, Math.round(termMonths), interestType, kind,
    monthlyPayment == null ? null : Math.round(monthlyPayment), note);
}

export async function updateDebt(
  id: number, lender: string | null, principal: number, rate: number, startDate: string,
  termMonths: number, interestType: string, kind: string,
  monthlyPayment: number | null, note: string | null,
) {
  await q(
    "UPDATE debts SET lender=?, principal=?, rate=?, start_date=?, term_months=?, interest_type=?, kind=?, monthly_payment=?, note=? WHERE id=?",
  ).run(lender, Math.round(principal), rate, startDate, Math.round(termMonths), interestType, kind,
    monthlyPayment == null ? null : Math.round(monthlyPayment), note, id);
}

export async function deleteDebt(id: number) {
  // Batched so a debt can never lose its payments without losing itself too.
  await db().batch([
    q("DELETE FROM debt_payments WHERE debt_id=?").bound(id),
    q("DELETE FROM debts WHERE id=?").bound(id),
  ]);
}

export async function listDebtPayments(debtId?: number): Promise<DebtPayment[]> {
  if (debtId != null)
    return q("SELECT * FROM debt_payments WHERE debt_id=? ORDER BY date, id").all<DebtPayment>(debtId);
  return q("SELECT * FROM debt_payments ORDER BY date, id").all<DebtPayment>();
}

export async function addDebtPayment(debtId: number, date: string, amount: number, note: string | null = null) {
  await q("INSERT INTO debt_payments(debt_id, date, amount, note) VALUES (?,?,?,?)")
    .run(debtId, date, Math.round(amount), note);
}

export async function updateDebtPayment(
  id: number, date: string, amount: number, note: string | null = null,
): Promise<boolean> {
  const meta = await q("UPDATE debt_payments SET date=?, amount=?, note=? WHERE id=?")
    .run(date, Math.round(amount), note, id);
  return (meta.changes ?? 0) > 0;
}

export async function deleteDebtPayment(id: number) {
  await q("DELETE FROM debt_payments WHERE id=?").run(id);
}

// ---------- instruments ----------

export async function ensureInstrument(name: string, assetType: string) {
  await q(
    "INSERT INTO instruments(name, asset_type, updated_at) VALUES (?,?,?) ON CONFLICT(name) DO NOTHING",
  ).run(name, assetType, nowIso());
}

/** Create a managed holding. Returns false if one with that name already exists. */
export async function addInstrument(
  name: string, assetType: string, priceSource: string,
  symbol: string | null, quantity: number | null, manualValue: number | null,
): Promise<boolean> {
  const meta = await q(
    "INSERT INTO instruments(name, asset_type, price_source, symbol, quantity, manual_value, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(name) DO NOTHING",
  ).run(name.trim(), assetType, priceSource, symbol || null, roundUnits(quantity), manualValue, nowIso());
  return (meta.changes ?? 0) > 0;
}

export async function listInstruments(): Promise<Instrument[]> {
  return q("SELECT * FROM instruments ORDER BY asset_type, name").all<Instrument>();
}

export async function getInstrument(name: string): Promise<Instrument | undefined> {
  return q("SELECT * FROM instruments WHERE name=?").get<Instrument>(name);
}

export async function instrumentNames(): Promise<string[]> {
  const rows = await q("SELECT name FROM instruments ORDER BY name").all<{ name: string }>();
  return rows.map((r) => r.name);
}

export async function updateInstrumentFields(
  name: string, assetType: string, priceSource: string,
  symbol: string | null, quantity: number | null, manualValue: number | null,
) {
  await q(
    "UPDATE instruments SET asset_type=?, price_source=?, symbol=?, quantity=?, manual_value=?, updated_at=? WHERE name=?",
  ).run(assetType, priceSource, symbol || null, roundUnits(quantity), manualValue, nowIso(), name);
}

/** Hide a fully-sold holding from the active list without losing its transaction or
 *  P&L history. Reversible — net worth already ignores it since its value is 0. */
export async function setInstrumentArchived(name: string, archived: boolean) {
  await q("UPDATE instruments SET archived=?, updated_at=? WHERE name=?")
    .run(archived ? 1 : 0, nowIso(), name);
}

export async function updatePrice(name: string, price: number) {
  await q("UPDATE instruments SET last_price=?, last_price_at=? WHERE name=?")
    .run(price, nowIso(), name);
}

export function holdingValue(row: Instrument): number {
  if (row.quantity != null && row.last_price != null)
    return Math.round(row.quantity * row.last_price);
  return row.manual_value ?? 0;
}

/** True if any transaction or recurring rule references this holding. */
export async function instrumentInUse(name: string): Promise<boolean> {
  const [tx, rule] = await Promise.all([
    q("SELECT 1 FROM transactions WHERE instrument=? LIMIT 1").get(name),
    q("SELECT 1 FROM recurring_rules WHERE instrument=? LIMIT 1").get(name),
  ]);
  return Boolean(tx || rule);
}

export async function deleteInstrument(name: string) {
  await q("DELETE FROM instruments WHERE name=?").run(name);
}

// ---------- recurring rules (auto-DCA) ----------

export async function addRecurring(
  instrument: string, assetType: string, amount: number,
  freq: string, startDate: string, note: string | null,
) {
  await q(
    "INSERT INTO recurring_rules(instrument, asset_type, amount, freq, start_date, note) VALUES (?,?,?,?,?,?)",
  ).run(instrument.trim(), assetType, Math.round(amount), freq, startDate, note);
  await ensureInstrument(instrument.trim(), assetType);
}

export async function updateRecurring(
  id: number, instrument: string, assetType: string, amount: number,
  freq: string, startDate: string, note: string | null,
) {
  await q(
    "UPDATE recurring_rules SET instrument=?, asset_type=?, amount=?, freq=?, start_date=?, note=? WHERE id=?",
  ).run(instrument.trim(), assetType, Math.round(amount), freq, startDate, note, id);
  await ensureInstrument(instrument.trim(), assetType);
}

export async function listRecurring(): Promise<RecurringRule[]> {
  return q("SELECT * FROM recurring_rules ORDER BY active DESC, instrument").all<RecurringRule>();
}

export async function toggleRecurring(id: number) {
  await q("UPDATE recurring_rules SET active = 1 - active WHERE id=?").run(id);
}

export async function deleteRecurring(id: number) {
  await q("DELETE FROM recurring_rules WHERE id=?").run(id);
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
export async function materializeRecurring(): Promise<number> {
  const today = dateOf(todayIso());
  let inserted = 0;
  const rules = await q("SELECT * FROM recurring_rules WHERE active=1").all<RecurringRule>();
  for (const rule of rules) {
    const start = dateOf(rule.start_date);
    const after = rule.last_run ? dateOf(rule.last_run) : null;
    let last: Date | null = null;
    for (const occ of occurrences(rule.freq, start, after, today)) {
      await addTransaction(isoOf(occ), rule.asset_type, rule.instrument, rule.amount,
        null, rule.note ?? "Auto-DCA");
      last = occ;
      inserted += 1;
    }
    if (last)
      await q("UPDATE recurring_rules SET last_run=? WHERE id=?").run(isoOf(last), rule.id);
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

export async function pendingFundUnits(days = 14): Promise<Tx[]> {
  const cutoff = isoOf(new Date(Date.now() - days * 86400000));
  return q(
    // amount > 0 only: a sale isn't "awaiting units", and confirming one would
    // add units to the holding rather than remove them.
    "SELECT * FROM transactions WHERE asset_type='Funds' AND quantity IS NULL AND amount > 0 AND date >= ? ORDER BY date DESC, id DESC",
  ).all<Tx>(cutoff);
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

export async function setTransactionQuantity(
  id: number, quantity: number, addToHoldings: boolean,
): Promise<boolean> {
  const tx = await getTransaction(id);
  if (!tx) return false;
  await q("UPDATE transactions SET quantity=? WHERE id=?").run(quantity, id);
  if (addToHoldings) {
    const inst = await getInstrument(tx.instrument);
    if (inst && inst.quantity != null)
      await q(`UPDATE instruments SET quantity = ROUND(quantity + ?, ${UNIT_DP}), updated_at=? WHERE name=?`)
        .run(quantity, nowIso(), tx.instrument);
  }
  return true;
}

// ---------- price sources (user-defined price feeds) ----------

const PRICE_SOURCE_COLS =
  "key, label, kind, method, url, body, batch, rows_path, key_field, price_field, price_path, price_regex, history_strategy, builtin, created_at";

export async function listPriceSources(): Promise<PriceSource[]> {
  return q(`SELECT ${PRICE_SOURCE_COLS} FROM price_sources ORDER BY builtin DESC, key`)
    .all<PriceSource>();
}

export async function getPriceSource(key: string): Promise<PriceSource | undefined> {
  return q(`SELECT ${PRICE_SOURCE_COLS} FROM price_sources WHERE key=?`).get<PriceSource>(key);
}

/** Upsert a price source. `builtin` is never changed on an existing row.
 *
 *  Was `@named` binding; D1 is positional only, so the VALUES list and the DO UPDATE list
 *  both re-bind the same values in order. Fourteen `?`s in VALUES, then twelve more for the
 *  update (key and builtin are deliberately not re-set). */
export async function savePriceSource(s: Omit<PriceSource, "created_at">): Promise<void> {
  await q(
    `INSERT INTO price_sources
       (key, label, kind, method, url, body, batch, rows_path, key_field,
        price_field, price_path, price_regex, history_strategy, builtin, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET
       label=?, kind=?, method=?, url=?, body=?, batch=?,
       rows_path=?, key_field=?, price_field=?,
       price_path=?, price_regex=?, history_strategy=?`,
  ).run(
    s.key, s.label, s.kind, s.method, s.url, s.body, s.batch, s.rows_path, s.key_field,
    s.price_field, s.price_path, s.price_regex, s.history_strategy, s.builtin, nowIso(),
    s.label, s.kind, s.method, s.url, s.body, s.batch,
    s.rows_path, s.key_field, s.price_field,
    s.price_path, s.price_regex, s.history_strategy,
  );
}

/** True if any instrument currently uses this source key. */
export async function priceSourceInUse(key: string): Promise<boolean> {
  return Boolean(await q("SELECT 1 FROM instruments WHERE price_source=? LIMIT 1").get(key));
}

export async function deletePriceSource(key: string): Promise<void> {
  await q("DELETE FROM price_sources WHERE key=?").run(key);
}

// ---------- price history + meta ----------

export async function upsertPriceHistory(instrument: string, map: Record<string, number>) {
  const stmt = q("INSERT OR REPLACE INTO price_history(instrument, date, price) VALUES (?,?,?)");
  const rows = Object.entries(map).filter(([, price]) => price);
  if (!rows.length) return;
  // D1 caps how much one batch may carry, and a backfill can hand us years of daily closes.
  // Chunked so a long history lands as a few atomic batches rather than one oversized one.
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db().batch(
      rows.slice(i, i + CHUNK).map(([date, price]) => stmt.bound(instrument, date, price)),
    );
  }
}

/** The transaction columns `lib/pnl.ts` reconstructs the daily series from. Exists because
 *  that module used to reach for the raw handle via `getDb()`, which no longer exists — the
 *  D1 binding is private to this file so every query stays somewhere it can be found. */
export async function pnlTransactions(): Promise<
  { date: string; instrument: string; amount: number; quantity: number | null }[]
> {
  return q("SELECT date, instrument, amount, quantity FROM transactions ORDER BY date, id")
    .all<{ date: string; instrument: string; amount: number; quantity: number | null }>();
}

export async function priceHistoryByInstrument(): Promise<Record<string, [string, number][]>> {
  const rows = await q("SELECT instrument, date, price FROM price_history ORDER BY instrument, date")
    .all<{ instrument: string; date: string; price: number }>();
  const out: Record<string, [string, number][]> = {};
  for (const r of rows) (out[r.instrument] ??= []).push([r.date, r.price]);
  return out;
}

// ---------- the live point (see `buildLatest` in lib/pnl.ts) ----------
//
// The three queries below exist so today's P&L point can be computed without reading the
// whole of `transactions` and `price_history`. They are what `pnlTransactions` +
// `priceHistoryByInstrument` are to `buildDaily`, except that none of them is bounded by
// how many days of history the app has accumulated — which is the property that matters,
// since the dashboard re-asks for today's point on every live-price tick.

/** One row per instrument, rolling up everything `buildLatest` needs from `transactions`.
 *
 *  Conditional aggregation rather than a `WHERE date <= end`, because the two figures want
 *  different windows: `invested` must ignore a future-dated transaction (the day loop in
 *  `buildDaily` only consumes rows with `date <= ds`), while `first_date` is the true
 *  minimum over *all* rows — an instrument whose only transaction is in the future has not
 *  started yet and must value at zero, which a filtered MIN would hide. */
export interface TxRollup {
  instrument: string;
  /** SUM(amount) over rows dated on or before `end`. */
  invested: number;
  /** SUM(amount) over *every* row, future-dated included — the cost basis, which is not a
   *  function of today. Feeds `livePayload`, so a tick needs no extra query for it. */
  cost_all: number;
  /** MIN(date) over every row, future ones included. */
  first_date: string;
  /** SUM(amount) for rows dated exactly `end` — the day's contribution, netted out of P&L. */
  today_amount: number;
  /** Units bought today that state their own quantity. */
  today_qty: number;
  /** Amount bought today with no recorded quantity — units are `amount / price(end)`. */
  today_amount_unqty: number;
  /** Rows dated after `end`. Normally 0; non-zero means `buildLatest` must price them. */
  future_count: number;
}

export async function txRollup(endIso: string): Promise<TxRollup[]> {
  return q(
    `SELECT instrument,
            SUM(CASE WHEN date <= ?1 THEN amount ELSE 0 END)  AS invested,
            SUM(amount)                                        AS cost_all,
            MIN(date)                                          AS first_date,
            SUM(CASE WHEN date  = ?1 THEN amount ELSE 0 END)  AS today_amount,
            SUM(CASE WHEN date  = ?1 AND quantity IS NOT NULL
                     THEN quantity ELSE 0 END)                 AS today_qty,
            SUM(CASE WHEN date  = ?1 AND quantity IS NULL
                     THEN amount ELSE 0 END)                   AS today_amount_unqty,
            COUNT(CASE WHEN date > ?1 THEN 1 END)              AS future_count
       FROM transactions
      GROUP BY instrument`,
  ).all<TxRollup>(endIso);
}

/** The two most recent stored closes per instrument, newest first.
 *
 *  Two is exactly enough. The newest is `priceAt(end)`; yesterday's is the same row when it
 *  predates yesterday (the feed has not settled today yet) and the second row otherwise.
 *  The row's `date` is what `anchorAt` returns, which is how `buildLatest` recovers the
 *  span a live move is really measured over.
 *
 *  Restricted to `date <= end`, which also serves as the tracked/manual test: an instrument
 *  with no close on or before today has nothing to price against and falls back to its
 *  manual value, exactly as an instrument with no price history at all does.
 *
 *  **One seek per instrument, batched — deliberately not a window function.** The obvious
 *  spelling of "top 2 per group" is `ROW_NUMBER() OVER (PARTITION BY instrument ...)`, and
 *  that is what this was. It returns the right answer and looks bounded, but SQLite cannot
 *  rank rows within a partition without first reading every row the `WHERE` admits:
 *  `EXPLAIN QUERY PLAN` reports `SCAN price_history`, and D1 measured it reading ~22k rows
 *  a call against a 5.5k-row table. That is the whole point of this function defeated — the
 *  read grew with the length of the history, which is the thing `buildLatest` exists to
 *  stop depending on.
 *
 *  Asked one instrument at a time it is a `SEARCH ... (instrument=? AND date<?)` against the
 *  `(instrument, date)` primary key — an index seek that reads exactly the 2 rows it
 *  returns. `batch()` keeps the whole set to a single round trip, so this is N seeks but not
 *  N network hops. Check the query plan, not just the wall clock, before believing either
 *  shape is cheap: on a table this small a full scan still returns in single-digit ms. */
export async function recentCloses(
  instruments: string[], endIso: string,
): Promise<{ instrument: string; date: string; price: number }[]> {
  if (!instruments.length) return [];
  const stmt = q(
    "SELECT date, price FROM price_history WHERE instrument=? AND date<=? ORDER BY date DESC LIMIT 2",
  );
  const batched = await db().batch<{ date: string; price: number }>(
    instruments.map((name) => stmt.bound(name, endIso)),
  );
  const out: { instrument: string; date: string; price: number }[] = [];
  for (let i = 0; i < batched.length; i += 1)
    for (const r of batched[i].results) out.push({ instrument: instruments[i], ...r });
  return out;
}

/** Transactions for named instruments, each carrying the close it would have been priced
 *  at — the SQL form of `priceLookup(points).priceAt(t.date)`, including its fallback to
 *  the earliest stored price for a transaction that predates the whole series.
 *
 *  Only called for instruments `buildLatest` cannot shortcut: one with no `quantity` of its
 *  own (its unit count is the sum of its transactions, so every one has to be priced) or
 *  one holding future-dated rows. Both are rare, and the read is bounded by those
 *  instruments' transaction counts — never by the length of the price history. */
export async function txUnitPrices(instruments: string[]): Promise<
  { instrument: string; date: string; amount: number; quantity: number | null;
    px_at: number | null; px_first: number | null }[]
> {
  if (!instruments.length) return [];
  const holes = instruments.map(() => "?").join(",");
  return q(
    `SELECT t.instrument, t.date, t.amount, t.quantity,
            (SELECT p.price FROM price_history p
              WHERE p.instrument = t.instrument AND p.date <= t.date
              ORDER BY p.date DESC LIMIT 1) AS px_at,
            (SELECT p.price FROM price_history p
              WHERE p.instrument = t.instrument
              ORDER BY p.date ASC LIMIT 1)  AS px_first
       FROM transactions t
      WHERE t.instrument IN (${holes})
      ORDER BY t.date, t.id`,
  ).all(...instruments);
}

export async function metaGet(key: string): Promise<string | null> {
  const row = await q("SELECT value FROM meta WHERE key=?").get<{ value: string }>(key);
  return row?.value ?? null;
}

export async function metaSet(key: string, value: string) {
  await q("INSERT OR REPLACE INTO meta(key, value) VALUES (?,?)").run(key, value);
}

// ---------- goals ----------

/** Ranked order: you decide it (`position`), so it wins over any date or metric. */
export async function listGoals(includeArchived = false): Promise<Goal[]> {
  const where = includeArchived ? "" : "WHERE archived = 0";
  return q(`SELECT * FROM goals ${where} ORDER BY archived, position, id`).all<Goal>();
}

export async function getGoal(id: number): Promise<Goal | undefined> {
  return q("SELECT * FROM goals WHERE id=?").get<Goal>(id);
}

export async function addGoal(
  name: string, metric: string, target: number, baseline: number,
  monthlyPlan: number | null, targetDate: string | null, note: string | null = null,
) {
  // New goals land at the bottom of the ranking — a fresh goal shouldn't quietly outrank
  // the ones you've already thought about.
  const row = await q("SELECT COALESCE(MAX(position), 0) p FROM goals").get<{ p: number }>();
  const last = row?.p ?? 0;
  await q(
    "INSERT INTO goals(name, metric, target, baseline, monthly_plan, target_date, position, note) VALUES (?,?,?,?,?,?,?,?)",
  ).run(name.trim(), metric, Math.round(target), Math.round(baseline),
    monthlyPlan == null ? null : Math.round(monthlyPlan), targetDate, last + 1, note);
}

export async function updateGoal(
  id: number, name: string, metric: string, target: number, baseline: number,
  monthlyPlan: number | null, targetDate: string | null, note: string | null,
) {
  await q(
    "UPDATE goals SET name=?, metric=?, target=?, baseline=?, monthly_plan=?, target_date=?, note=? WHERE id=?",
  ).run(name.trim(), metric, Math.round(target), Math.round(baseline),
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
export async function moveGoal(id: number, direction: "up" | "down"): Promise<boolean> {
  const goal = await getGoal(id);
  if (!goal) return false;

  const neighbour = await q(
    direction === "up"
      ? `SELECT id, position FROM goals WHERE archived = ? AND (position < ? OR (position = ? AND id < ?))
         ORDER BY position DESC, id DESC LIMIT 1`
      : `SELECT id, position FROM goals WHERE archived = ? AND (position > ? OR (position = ? AND id > ?))
         ORDER BY position ASC, id ASC LIMIT 1`,
  ).get<{ id: number; position: number }>(goal.archived, goal.position, goal.position, id);
  if (!neighbour) return false;

  // Ties are possible (a DB seeded before positions existed, say), and swapping equal
  // positions would be a no-op that silently does nothing — so re-rank by index instead.
  // Batched, so the board can never be left with both goals on the same position.
  const set = q("UPDATE goals SET position = ? WHERE id = ?");
  await db().batch(
    goal.position === neighbour.position
      ? [set.bound(direction === "up" ? goal.position - 1 : goal.position + 1, id)]
      : [set.bound(neighbour.position, id), set.bound(goal.position, neighbour.id)],
  );
  return true;
}

export async function setGoalArchived(id: number, archived: boolean) {
  await q("UPDATE goals SET archived=? WHERE id=?").run(archived ? 1 : 0, id);
}

export async function deleteGoal(id: number) {
  await db().batch([
    q("DELETE FROM goal_contributions WHERE goal_id=?").bound(id),
    // Un-earmark, don't delete: the deposits are real money and outlive the goal.
    q("UPDATE savings SET goal_id=NULL WHERE goal_id=?").bound(id),
    q("DELETE FROM goals WHERE id=?").bound(id),
  ]);
}

/** Release every deposit earmarked for a goal, leaving the deposits themselves untouched. */
export async function unlinkGoalSavings(goalId: number) {
  await q("UPDATE savings SET goal_id=NULL WHERE goal_id=?").run(goalId);
}

/** Deposits earmarked for a sinking fund, keyed by goal id. */
export async function savingsByGoal(): Promise<Record<number, Saving[]>> {
  const byGoal: Record<number, Saving[]> = {};
  for (const s of await listSavings()) {
    if (s.goal_id != null) (byGoal[s.goal_id] ??= []).push(s);
  }
  return byGoal;
}

// ---------- sinking-fund contributions ----------

/** Every contribution, or just one goal's. Oldest first, so a ledger reads top-down. */
export async function listGoalContributions(goalId?: number): Promise<GoalContribution[]> {
  return goalId == null
    ? q("SELECT * FROM goal_contributions ORDER BY date, id").all<GoalContribution>()
    : q("SELECT * FROM goal_contributions WHERE goal_id=? ORDER BY date, id").all<GoalContribution>(goalId);
}

export async function addGoalContribution(
  goalId: number, date: string, amount: number, note: string | null = null,
) {
  await q("INSERT INTO goal_contributions(goal_id, date, amount, note) VALUES (?,?,?,?)")
    .run(goalId, date, Math.round(amount), note);
}

export async function deleteGoalContribution(id: number) {
  await q("DELETE FROM goal_contributions WHERE id=?").run(id);
}

/** The *cash* a fund holds right now — the ledger only, not its earmarked deposits. */
export async function fundCash(goalId: number, today = new Date()): Promise<number> {
  return fundCashAt(await listGoalContributions(goalId), today);
}

/**
 * Everything a fund is worth: cash set aside, plus the live value of the deposits
 * earmarked for it (each with its own rate and term — see `Saving.goal_id`).
 */
export async function fundValue(goalId: number, today = new Date()): Promise<number> {
  const byGoal = await savingsByGoal();
  const deposits = (byGoal[goalId] ?? []).reduce((a, s) => a + currentValue(s, today), 0);
  return (await fundCash(goalId, today)) + deposits;
}

/**
 * Cash set aside across every sinking fund — net worth's extra line.
 *
 * Deposits are deliberately NOT in here: an earmarked deposit is already counted under
 * Savings, and adding it again would inflate net worth by the same money twice. Only the
 * un-deposited cash is new. Archived funds still count — "mark as bought" drains the pot,
 * so anything left in one is money you still hold, watched or not.
 */
export async function fundsCashTotal(today = new Date()): Promise<number> {
  // One query for every fund's ledger, rather than one per fund: on D1 each round trip has
  // real latency, so the old per-goal loop would have cost a request each.
  const rows = await q(
    `SELECT c.goal_id, c.date, c.amount
       FROM goal_contributions c
       JOIN goals g ON g.id = c.goal_id
      WHERE g.metric = 'fund'
      ORDER BY c.date, c.id`,
  ).all<GoalContribution>();
  const byGoal: Record<number, GoalContribution[]> = {};
  for (const r of rows) (byGoal[r.goal_id] ??= []).push(r);
  return Object.values(byGoal).reduce((a, ledger) => a + fundCashAt(ledger, today), 0);
}

/** ₫/month you've committed to via active recurring rules — the *forward* contribution
 *  rate, which is what a projection actually wants (a trailing average only looks back). */
export async function plannedMonthly(): Promise<number> {
  const rules = await q("SELECT amount, freq FROM recurring_rules WHERE active=1")
    .all<{ amount: number; freq: string }>();
  return rules.reduce((a, r) => a + (r.freq === "weekly" ? (r.amount * 52) / 12 : r.amount), 0);
}

/** ₫/month actually contributed over the trailing window — the fallback pace when there
 *  are no recurring rules. Net of sells, floored at 0. */
export async function actualMonthly(months = 6): Promise<number> {
  const since = addMonthsIso(todayIso(), -months);
  const row = await q("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE date >= ?")
    .get<{ s: number }>(since);
  return Math.max(0, (row?.s ?? 0) / months);
}

function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d, lastDay));
  return base.toISOString().slice(0, 10);
}

/** Gathers everything `lib/goals.ts` needs to project a goal forward. */
export async function buildGoalWorld(investments: number): Promise<GoalWorld> {
  // Independent reads, so they go out together — eight sequential round trips to D1 would
  // otherwise be the slowest thing on the dashboard.
  const [payments, contribs, funds, savings, debts, byGoal, planned, actual] = await Promise.all([
    listDebtPayments(),
    listGoalContributions(),
    q("SELECT id FROM goals WHERE metric='fund'").all<{ id: number }>(),
    listSavings(),
    listDebts(),
    savingsByGoal(),
    plannedMonthly(),
    actualMonthly(),
  ]);

  const paymentsByDebt: Record<number, Payment[]> = {};
  for (const p of payments) (paymentsByDebt[p.debt_id] ??= []).push(p);

  const contributions: Record<number, GoalContribution[]> = {};
  for (const c of contribs) (contributions[c.goal_id] ??= []).push(c);

  return {
    today: todayIso(),
    nowMs: Date.now(),
    investments,
    savings,
    debts,
    paymentsByDebt,
    // Every fund, archived included — see `fundsCashTotal`. Net worth has to see the money
    // even when the goal watching it has been put away.
    funds,
    contributions,
    savingsByGoal: byGoal,
    plannedMonthly: planned,
    actualMonthly: actual,
  };
}

// ---------- dashboard payload ----------

/**
 * The price-derived figures, from rows the caller already holds. Pure — no queries.
 *
 * Shared by `buildPayload` (a full page render) and `buildLatest` (a live tick), which is
 * the point: the dashboard shows these numbers continuously, and two code paths computing
 * them separately would eventually disagree and make the KPI tiles contradict the
 * allocation donut beside them.
 *
 * `costByInstrument` is `SUM(amount) GROUP BY instrument` over *all* transactions —
 * unfiltered by date, which is what the cost basis means. Note this is a different
 * valuation basis from `lib/pnl.ts`: here a holding is `quantity × last_price`
 * (`holdingValue`), whereas the P&L series prices a NAV fund at its stored close because
 * its `last_price` is a past valuation day's NAV. Both are right in their own place; don't
 * cross them.
 */
export function livePayload(
  instruments: Instrument[],
  costByInstrument: Record<string, number>,
): LivePayload {
  const portfolio: LivePayload["portfolio"] = [];
  for (const row of instruments) {
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

  const portfolioTotal = portfolio.reduce((a, p) => a + p.value, 0);
  // Summing the per-instrument totals is the same figure the old dedicated
  // `SELECT SUM(amount) FROM transactions` returned — the GROUP BY covers every row —
  // so that query, and the MAX(last_price_at) one below it, are no longer issued.
  let investedTotal = 0;
  for (const c of Object.values(costByInstrument)) investedTotal += c;

  const alloc: Record<string, number> = {};
  for (const p of portfolio) alloc[p.type] = (alloc[p.type] ?? 0) + p.value;

  let pricesAsOf: string | null = null;
  for (const r of instruments)
    if (r.last_price_at && (pricesAsOf === null || r.last_price_at > pricesAsOf))
      pricesAsOf = r.last_price_at;

  return {
    portfolio, portfolioTotal, investedTotal,
    pnl: portfolioTotal - investedTotal,
    allocation: Object.entries(alloc)
      .map(([type, value]) => ({ type, value }))
      .sort((a, b) => b.value - a.value),
    pricesAsOf,
  };
}

export async function buildPayload(): Promise<Payload> {
  const [costRows, instruments] = await Promise.all([
    q("SELECT instrument, SUM(amount) c FROM transactions GROUP BY instrument")
      .all<{ instrument: string; c: number }>(),
    listInstruments(),
  ]);

  const costByInstrument: Record<string, number> = {};
  for (const r of costRows) costByInstrument[r.instrument] = r.c;

  return {
    ...livePayload(instruments, costByInstrument),
    generated: new Date().toLocaleString("sv-SE").slice(0, 16),
  };
}
