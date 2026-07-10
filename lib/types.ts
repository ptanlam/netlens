/** Shared types & constants safe to import from client components (no Node deps). */

export const ASSET_TYPES = ["Funds", "Stocks", "Crypto", "Real Estate"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export const PRICE_SOURCES = ["manual", "coingecko", "yahoo", "fmarket"] as const;

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
