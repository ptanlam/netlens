/** Shared types & constants safe to import from client components (no Node deps). */

export const ASSET_TYPES = ["Funds", "Stocks", "Crypto", "Real Estate"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
/** The always-present, no-fetch source. Every other source is user-defined in the DB. */
export const MANUAL_SOURCE = "manual";

export type PriceSourceKind = "json" | "html";
export type HistoryStrategy = "none" | "yahoo" | "coingecko" | "fmarket";

/**
 * A user-defined price feed, stored in the DB and driving `lib/prices.ts`.
 * `kind`:  'json' extracts a number via dot-paths; 'html' via a regex capture group.
 * `batch`: 1 = a single request returns prices for many instruments (matched by
 *          `symbol ?? name`); 0 = one request per instrument, with `{symbol}` in the URL.
 * URL/body templates support `{symbol}` (per-instrument) and `{symbols}` (batch, the
 * comma-joined sorted symbols).
 */
export interface PriceSource {
  key: string;                  // stable id stored on instruments.price_source
  label: string;
  kind: PriceSourceKind;
  method: "GET" | "POST";
  url: string;
  body: string | null;          // POST body template (JSON string)
  batch: number;                // 0 | 1
  rows_path: string | null;     // batch json: dot-path to the rows array/object ("" = root)
  key_field: string | null;     // batch json: field in each row matching the instrument symbol
  price_field: string | null;   // batch json: field holding the price value
  price_path: string | null;    // single json: dot-path to the price value
  price_regex: string | null;   // html: regex with one capture group
  history_strategy: string;     // HistoryStrategy — which built-in history fetcher to use
  builtin: number;              // 1 = seeded, protected from deletion
  created_at: string | null;
}

export const INTEREST_TYPES = ["simple", "compound"] as const;
export type InterestType = (typeof INTEREST_TYPES)[number];

export const DEBT_KINDS = ["fixed", "flexible", "credit"] as const;
export type DebtKind = (typeof DEBT_KINDS)[number];

export interface Tx {
  id: number;
  date: string;
  asset_type: string;
  instrument: string;
  amount: number;
  quantity: number | null;
  note: string | null;
  created_at: string;
}

export interface Instrument {
  name: string;
  asset_type: string;
  price_source: string;
  symbol: string | null;
  quantity: number | null;
  manual_value: number | null;
  last_price: number | null;
  last_price_at: string | null;
  updated_at: string | null;
}

export interface RecurringRule {
  id: number;
  instrument: string;
  asset_type: string;
  amount: number;
  freq: "weekly" | "monthly";
  start_date: string;
  last_run: string | null;
  active: number;
  note: string | null;
  created_at: string;
}

export interface Saving {
  id: number;
  bank: string | null;
  principal: number;
  rate: number;
  start_date: string;
  term_months: number;
  interest_type: InterestType;
  /** Earmarked for a sinking-fund goal, if any. The deposit still counts once — under
   *  Savings in net worth — and its live value counts toward that goal's progress. */
  goal_id: number | null;
  note: string | null;
  created_at: string;
}

export interface Debt {
  id: number;
  lender: string | null;
  principal: number;
  rate: number;
  start_date: string;
  term_months: number;
  interest_type: InterestType;
  kind: DebtKind;
  monthly_payment: number | null;
  note: string | null;
  created_at: string;
}

export interface DebtPayment {
  id: number;
  debt_id: number;
  date: string;
  amount: number;
  note: string | null;
  created_at: string;
}

/**
 * What a goal tracks. Four of these are figures the dashboard already computes, so the
 * goal reads them live. `fund` is the odd one out: a sinking fund (a car, a wedding) is
 * money you set aside on purpose, which no other figure knows about — so it carries its
 * own ledger of contributions, and its "current value" is that balance.
 */
export const GOAL_METRICS = ["net_worth", "investments", "savings", "debts", "fund"] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

export const GOAL_METRIC_LABELS: Record<GoalMetric, string> = {
  net_worth: "Net worth",
  investments: "Investments",
  savings: "Savings",
  debts: "Debts",
  fund: "Sinking fund",
};

/**
 * A target on a metric, with an optional deadline. Progress is *derived* from the live
 * metric on every render — a goal stores no balance of its own and can never go stale.
 *
 * `baseline`: progress is measured from here, so a debt payoff starts at 0%, not at the
 *   40% you'd already cleared before you created the goal.
 * `monthly_plan`: what you intend to put in each month. Overrides the pace Netlens would
 *   otherwise infer from your recurring rules — and it's the only way a `savings` goal
 *   gets a projection, since nothing else tells us about future deposits.
 * `target_date`: NULL means "someday" — progress still tracks, nothing is ever "late".
 */
export interface Goal {
  id: number;
  name: string;
  metric: GoalMetric;
  target: number;
  baseline: number;
  monthly_plan: number | null;
  target_date: string | null;
  /** Where you ranked it. Lower comes first, and it beats every other ordering — the whole
   *  point is that you, not a deadline, decide which goal matters most. */
  position: number;
  archived: number;
  note: string | null;
  created_at: string;
}

/**
 * One movement of cash into (+) or out of (−) a sinking fund. The balance is just the sum,
 * so a withdrawal is a negative row and buying the thing is a single row that drains the pot.
 *
 * This is *cash* — money set aside but not yet deposited anywhere, so it earns nothing.
 * A fund grows interest by earmarking savings deposits to it instead (`Saving.goal_id`):
 * each deposit keeps its own rate and term, which is how it actually works — you take
 * whatever rate was on offer the month you had the money.
 */
export interface GoalContribution {
  id: number;
  goal_id: number;
  date: string;
  amount: number;
  note: string | null;
  created_at: string;
}

export interface Payload {
  contributions: { date: string; asset_type: string; amount: number }[];
  portfolio: { name: string; value: number; type: string; live: boolean; cost: number; pnl: number }[];
  portfolioTotal: number;
  investedTotal: number;
  pnl: number;
  allocation: { type: string; value: number }[];
  pricesAsOf: string | null;
  generated: string;
}

export interface PnlPoint {
  date: string;
  invested: number;
  value: number;
  pnl: number;
}

/** One holding's contribution to a single day's P&L move. */
export interface HoldingDayPnl {
  name: string;
  type: string;
  value: number; // holding value at end of day (rounded VND)
  pnl: number;   // day-over-day P&L change for this holding (value move net of contributions)
}

/** Per-holding breakdown of a single day, sums to that day's total P&L move. */
export interface HoldingPnlPoint {
  date: string;
  holdings: HoldingDayPnl[];
}
