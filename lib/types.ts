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
