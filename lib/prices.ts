/**
 * Live + historical price fetching, driven by the user-defined `price_sources`
 * table (see lib/db.ts). Each source is a generic config:
 *  - live prices  -> `refreshAll` interprets the config (json/html, GET/POST,
 *                    batch vs per-instrument, dot-paths / regex) — no code change
 *                    is needed to add a new feed.
 *  - daily history -> `refreshHistory` still uses the four built-in fetchers,
 *                    dispatched by each source's `history_strategy`.
 * Failures are collected, never thrown, so one bad ticker can't break a refresh.
 */
import {
  isDormant, listInstruments, listPriceSources, updatePrice, upsertPriceHistory,
  metaGet, metaSet, setFxRates, syncFxTargets, todayIso,
} from "./db";
import type { Instrument, PriceSource } from "./types";
import { MANUAL_SOURCE } from "./types";

/** Price sources keyed by `key`. One query instead of a `getPriceSource()` per holding —
 *  on D1 that per-row lookup would be a network round trip each time round the loop. */
async function priceSourceMap(): Promise<Map<string, PriceSource>> {
  return new Map((await listPriceSources()).map((s) => [s.key, s]));
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const FMARKET_URL = "https://api.fmarket.vn/res/products/filter";
const FMARKET_NAV_HISTORY_URL = "https://api.fmarket.vn/res/product/get-nav-history";
const HISTORY_FROM = "20250101";

/** Sources that trade every day (no exchange calendar). Only these may have their
 *  live price stamped into `price_history` under "today" — for exchange/NAV sources
 *  (stocks, funds) a live snapshot on a closed day (weekend/holiday) or mid-session
 *  is not a real daily close, so the historical series is left to `refreshHistory`,
 *  which keys official closes to actual trading dates. */
const CONTINUOUS_STRATEGIES = new Set(["coingecko"]);

/** The date a daily bar belongs to, as the *venue* reckons it.
 *
 *  `gmtOffsetSeconds` is the venue's offset from UTC — Yahoo hands it over as
 *  `meta.gmtoffset`; CoinGecko buckets its daily points on UTC midnight, so 0. Reading
 *  the runtime's local date instead (the previous behaviour) silently gave two answers
 *  for the same bar: UTC on the Worker, the developer's machine under `pnpm dev`. Both
 *  happen to agree for the feeds in use — a HOSE bar is stamped 02:00Z — but the moment
 *  a venue's session opens on the far side of UTC midnight they would not. */
function isoFromEpoch(seconds: number, gmtOffsetSeconds = 0): string {
  return new Date((seconds + gmtOffsetSeconds) * 1000).toISOString().slice(0, 10);
}

/** ICT (+07), the venue offset for HOSE/HNX. Yahoo hands this over as `meta.gmtoffset`;
 *  DNSE states no offset at all, so its bars — stamped 09:00 ICT, i.e. 02:00Z — need it
 *  supplied to land on the right calendar day. */
const HOSE_GMT_OFFSET = 7 * 3600;

/** Add `days` to a YYYY-MM-DD string (UTC math, no timezone drift). */
function isoAddDays(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).valueOf() + days * 86400000).toISOString().slice(0, 10);
}

/** True for Saturday/Sunday — funds never strike a NAV on a weekend, so such a
 *  date is always a data artifact and must not enter a fund's price history. */
function isWeekendIso(iso: string): boolean {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/** The trading day before `iso` (steps back over weekends). A fund's NAV is struck at
 *  the close of a trading day and only *reported* the next day, so the value a feed
 *  publishes under date D is the valuation for the previous trading day — this maps a
 *  reported date to that true valuation date, keeping the daily P&L calendar precise. */
function prevTradingDayIso(iso: string): string {
  let d = isoAddDays(iso, -1);
  while (isWeekendIso(d)) d = isoAddDays(d, -1);
  return d;
}

// ---------- generic config engine (live prices) ----------

/** Substitute `{name}` placeholders in a URL/body template. */
function interpolate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

/** Walk a dot-path (e.g. "chart.result.0.meta.price"). "" / null returns the root. */
function getPath(obj: unknown, path: string | null): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Coerce a JSON/HTML value to a number, tolerating comma grouping ("1,234.5"). */
function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Issue a source's HTTP request, returning parsed JSON or raw HTML text. */
async function callSource(src: PriceSource, vars: Record<string, string>): Promise<unknown> {
  const headers: Record<string, string> = { "User-Agent": UA };
  const init: RequestInit = { headers, cache: "no-store" };
  if (src.method === "POST") {
    init.method = "POST";
    headers["Content-Type"] = "application/json";
    headers["Accept"] = "application/json";
    init.body = interpolate(src.body ?? "", vars);
  }
  const res = await fetch(interpolate(src.url, vars), init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return src.kind === "html" ? res.text() : res.json();
}

/** Batch json → `{ lookupKey: price }`. Handles both an array of rows
 *  (matched via `key_field`) and an object keyed by symbol (e.g. CoinGecko). */
function extractBatch(src: PriceSource, data: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const rows = getPath(data, src.rows_path);
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (row == null || typeof row !== "object") continue;
      const k = src.key_field ? (row as Record<string, unknown>)[src.key_field] : undefined;
      const n = toNumber(src.price_field ? getPath(row, src.price_field) : row);
      if (k != null && n != null) out[String(k)] = n;
    }
  } else if (rows && typeof rows === "object") {
    for (const [k, v] of Object.entries(rows as Record<string, unknown>)) {
      const n = toNumber(src.price_field ? getPath(v, src.price_field) : v);
      if (n != null) out[k] = n;
    }
  }
  return out;
}

/** Single-value extraction for per-instrument sources (json dot-path or html regex). */
function extractSingle(src: PriceSource, data: unknown): number | null {
  if (src.kind === "html") {
    if (!src.price_regex) return null;
    const m = String(data).match(new RegExp(src.price_regex));
    return m ? toNumber(m[1]) : null;
  }
  return toNumber(getPath(data, src.price_path));
}

// ---------- exchange rates ----------

/**
 * Vietcombank's published board, as JSON: `{ Data: [{ currencyCode, cash, transfer, sell }],
 * UpdatedDate }`. Their older XML endpoint warns "only one request every 5 minutes", hence
 * the throttle below — this is a courtesy rate limit as much as a cost one.
 *
 * A bank rather than a market feed (Yahoo's `USDVND=X` is the interbank rate) because the
 * question a goal in dollars asks is "how much dong does $100k cost me", and the answer is
 * the rate you can actually transact at. `sell` is that side — what the bank charges you
 * for a dollar — which is also the conservative one: it prices the target *high*, so a goal
 * is never quietly easier than it looks.
 */
const VCB_RATES_URL = "https://www.vietcombank.com.vn/api/exchangerates?date=now";
const FX_SOURCE_LABEL = "Vietcombank (sell)";

/** Currencies worth storing. Their board carries twenty; a goal can be set in these. */
const FX_WANTED = new Set(["USD"]);

/** How stale a stored rate may be before it's refetched. A bank posts its board a few
 *  times a day, so re-asking on every one-minute price tick would be pure noise. */
const FX_MAX_AGE_MINUTES = 30;

interface VcbRate {
  currencyCode?: unknown;
  sell?: unknown;
}

/**
 * Refresh the FX rates, then re-cache the VND target of every goal denominated in one.
 *
 * Self-throttling, like the history fetchers, so `refreshAll` can call it every tick.
 * Returns the errors only — a rate isn't a "price updated" and must not inflate that count.
 */
export async function refreshFxRates(maxAgeMinutes = FX_MAX_AGE_MINUTES): Promise<string[]> {
  const at = await metaGet("fx_fetched_at");
  // `nowIso` stores UTC with the "Z" trimmed off; parsing it back without one would be read
  // as *local* time and put the gate seven hours out here.
  if (at && Date.now() - Date.parse(at + "Z") < maxAgeMinutes * 60_000) return [];

  try {
    const res = await fetch(VCB_RATES_URL, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { Data?: VcbRate[] };
    const rate: Record<string, number> = {};
    for (const row of data.Data ?? []) {
      const ccy = String(row.currencyCode ?? "").toUpperCase();
      const sell = toNumber(row.sell);
      // A rate of zero is how their board marks a currency it isn't quoting today; taking
      // it literally would drive every dollar target to ₫0 and report the goal complete.
      if (FX_WANTED.has(ccy) && sell && sell > 0) rate[ccy] = sell;
    }
    if (!Object.keys(rate).length) throw new Error("no usable rate in the response");

    await setFxRates(rate, FX_SOURCE_LABEL);
    await syncFxTargets(rate);
    return [];
  } catch (e) {
    // Never fatal: the stored rate stays, and a goal keeps the target it had. A rate
    // outage costs freshness, not correctness.
    return [`exchange rates (${FX_SOURCE_LABEL}): ${(e as Error).message}`];
  }
}

/** Fetch live prices for every auto-priced instrument. Returns [updated, errors]. */
export async function refreshAll(): Promise<[number, string[]]> {
  const [instruments, sources] = await Promise.all([listInstruments(), priceSourceMap()]);
  // `isDormant` is what stops a sold-out holding being quoted forever. It used to be
  // fetched on every five-minute tick — an upstream request and a D1 write apiece — to
  // reprice zero units, which no screen shows and no total can feel.
  const priced = instruments.filter(
    (r) => r.price_source && r.price_source !== MANUAL_SOURCE && !isDormant(r),
  );
  let updated = 0;
  const errors: string[] = [];
  const today = todayIso();

  const groups = new Map<string, Instrument[]>();
  for (const r of priced) {
    const g = groups.get(r.price_source);
    if (g) g.push(r);
    else groups.set(r.price_source, [r]);
  }

  for (const [key, rows] of groups) {
    const src = sources.get(key);
    if (!src) {
      errors.push(`${rows.length} holding(s): unknown price source '${key}'`);
      continue;
    }
    // Only continuously-traded sources (crypto) may stamp their live price into the
    // daily history — a stock/fund snapshot on a closed market isn't a real close.
    const trackDaily = CONTINUOUS_STRATEGIES.has(src.history_strategy);
    try {
      if (src.batch) {
        const symbols = [...new Set(rows.map((r) => r.symbol).filter(Boolean) as string[])].sort();
        const data = await callSource(src, { symbols: symbols.map(encodeURIComponent).join(",") });
        const prices = extractBatch(src, data);
        for (const r of rows) {
          const lookup = r.symbol ?? r.name;
          if (prices[lookup] != null) {
            await updatePrice(r.name, prices[lookup]);
            if (trackDaily) await upsertPriceHistory(r.name, { [today]: prices[lookup] });
            updated += 1;
          }
          else errors.push(`${r.name}: no ${src.label} price for '${lookup}'`);
        }
      } else {
        for (const r of rows) {
          try {
            const data = await callSource(src, { symbol: encodeURIComponent(r.symbol ?? "") });
            const price = extractSingle(src, data);
            if (price != null) {
              await updatePrice(r.name, price);
              if (trackDaily) await upsertPriceHistory(r.name, { [today]: price });
              updated += 1;
            }
            else errors.push(`${r.name}: no ${src.label} price`);
          } catch (e) { errors.push(`${r.name}: ${(e as Error).message}`); }
        }
      }
    } catch (e) { errors.push(`${src.label}: ${(e as Error).message}`); }
  }

  // Rides the same tick as the prices: a goal denominated in dollars is quoted by the same
  // act that quotes a holding, and there is no second mechanism to remember to run.
  errors.push(...(await refreshFxRates()));

  return [updated, errors];
}

export interface PriceTestResult {
  ok: boolean;
  message: string;
  price?: number;
}

/** Dry-run one source config against a sample symbol — same fetch + extraction as
 *  `refreshAll`, but writes nothing. Powers the "Test connection" button. */
export async function testPriceSource(src: PriceSource, symbol: string): Promise<PriceTestResult> {
  const sym = symbol.trim();
  try {
    if (src.batch) {
      const data = await callSource(src, { symbols: encodeURIComponent(sym) });
      const prices = extractBatch(src, data);
      const keys = Object.keys(prices);
      if (sym && prices[sym] != null)
        return { ok: true, price: prices[sym], message: `${sym} = ${prices[sym].toLocaleString()}` };
      if (!keys.length)
        return { ok: false, message: "Request worked but parsed 0 prices — the symbol may be unknown, or check rows path / key field / price field." };
      const preview = keys.slice(0, 8).join(", ") + (keys.length > 8 ? "…" : "");
      return {
        ok: false,
        message: sym
          ? `No price for '${sym}'. Parsed ${keys.length} symbol(s): ${preview}`
          : `Enter a test symbol. Parsed ${keys.length} symbol(s): ${preview}`,
      };
    }
    const data = await callSource(src, { symbol: encodeURIComponent(sym) });
    const price = extractSingle(src, data);
    if (price != null) return { ok: true, price, message: `Price = ${price.toLocaleString()}` };
    return {
      ok: false,
      message: `Request worked but no price was extracted — check the ${src.kind === "html" ? "regex" : "price path"}.`,
    };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// ---------- daily price history (for the P&L-over-time chart) ----------

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

interface FmarketRow { id: number; shortName: string }

async function fmarketRows(): Promise<FmarketRow[]> {
  const data = await postJson<{ data: { rows: FmarketRow[] } }>(FMARKET_URL, {
    types: ["NEW_FUND", "TRADING_FUND"], page: 1, pageSize: 100,
  });
  return data.data?.rows ?? [];
}

/**
 * Daily closes from Yahoo, *excluding the session in progress*.
 *
 * Yahoo's newest daily bar is the current session, and its "close" is only the last
 * print — at the open it is still yesterday's close carried forward. Storing that as a
 * settled close is how a day ends up frozen at the previous day's price: the move then
 * goes missing from the day it belongs to and is double-counted into the next one.
 * `meta.currentTradingPeriod.regular` says when the session runs, so any bar at or after
 * its start is dropped until that session has ended.
 */
export async function fetchYahooHistory(
  symbol: string, range = "2y",
): Promise<Record<string, number>> {
  const data = await getJson<{
    chart: {
      result?: {
        meta?: {
          gmtoffset?: number;
          currentTradingPeriod?: { regular?: { start?: number; end?: number } };
        };
        timestamp?: number[];
        indicators?: { quote?: { close?: (number | null)[]; volume?: (number | null)[] }[] };
      }[];
    };
  }>(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`);
  const result = data.chart.result?.[0];
  const stamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const volumes = result?.indicators?.quote?.[0]?.volume ?? [];
  const gmtOffset = result?.meta?.gmtoffset ?? 0;

  // Compared as epochs, not dates, so this holds for a venue whose session straddles UTC
  // midnight. Outside trading hours `regular` describes the *next* session, whose start is
  // still in the future — no real bar can reach it, so nothing is dropped.
  const regular = result?.meta?.currentTradingPeriod?.regular;
  const now = Date.now() / 1000;
  const unsettledFrom =
    regular?.start != null && regular.end != null && now < regular.end ? regular.start : Infinity;

  const out: Record<string, number> = {};
  stamps.forEach((ts, i) => {
    const c = closes[i];
    // A zero-volume bar is a day the venue never traded — a holiday Yahoo pads out rather
    // than omits — and its "close" is just the previous session's, carried forward. Storing
    // it would invent a settled close for a day that never had one, and the next real
    // session's move would then read as a one-day move measured from a price two sessions
    // old. Dropped, so the day resolves back to the last close that was actually struck.
    if (c && volumes[i] !== 0 && ts < unsettledFrom) out[isoFromEpoch(ts, gmtOffset)] = c;
  });
  return out;
}

/**
 * Daily closes from DNSE's public chart API (services.entrade.com.vn).
 *
 * Yahoo is the live-price source for VN tickers but cannot be trusted for their daily
 * history: it silently pads a missing HOSE session with a synthetic bar — `open = high =
 * low = close` at the previous close, `volume: 0` — instead of omitting the day. Stored,
 * that invents a settled close nobody traded at, so the real session's move goes missing
 * from its own day and lands on the next one. 2026-08-03 is the case in point: HOSE traded
 * (HPG alone did 44M shares) and Yahoo has none of it.
 *
 * DNSE is a licensed VN broker and reports the session; SSI's iBoard API returns numbers
 * identical to it, so two independent brokers corroborate. Note this covers **VN tickers
 * only** — a non-VN symbol on this strategy returns nothing rather than erroring.
 */
export async function fetchEntradeHistory(
  symbol: string, fromIso?: string,
): Promise<Record<string, number>> {
  // Yahoo's suffix, which DNSE doesn't use: our instruments store "FPT.VN", it wants "FPT".
  const ticker = symbol.replace(/\.VN$/i, "");
  // A full backfill reaches 3y, comfortably past the 2y Yahoo used to store, so no stretch
  // of the series is left on Yahoo's basis. That matters beyond staleness: Yahoo's daily
  // closes are dividend/split-**adjusted** while DNSE reports the raw close, so a range
  // served half by each puts a step in the chart at the seam — FPT's 2024-12-31 is ₫132,609
  // on Yahoo against ₫128,370 on DNSE, a phantom -3.5% overnight. One basis throughout.
  const from = Math.floor(
    new Date(`${fromIso ?? isoAddDays(todayIso(), -3 * 365)}T00:00:00Z`).valueOf() / 1000,
  );
  const to = Math.floor(Date.now() / 1000);
  const data = await getJson<{ t?: number[]; c?: number[]; v?: number[] }>(
    `https://services.entrade.com.vn/chart-api/v2/ohlcs/stock?symbol=${encodeURIComponent(ticker)}&resolution=1D&from=${from}&to=${to}`,
  );
  const stamps = data.t ?? [];
  const closes = data.c ?? [];
  const volumes = data.v ?? [];
  const out: Record<string, number> = {};
  stamps.forEach((ts, i) => {
    const c = closes[i];
    // DNSE quotes in thousands of VND (67.1 → ₫67,100); the rest of the app is whole VND.
    if (c && volumes[i] !== 0) out[isoFromEpoch(ts, HOSE_GMT_OFFSET)] = Math.round(c * 1000);
  });
  return out;
}

export async function fetchCoingeckoHistory(
  coinId: string, days = 365,
): Promise<Record<string, number>> {
  const data = await getJson<{ prices: [number, number][] }>(
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=vnd&days=${days}&interval=daily`,
  );
  const out: Record<string, number> = {};
  for (const [ms, p] of data.prices ?? []) if (p) out[isoFromEpoch(ms / 1000)] = p;
  return out;
}

export async function fetchFmarketNavHistory(
  productId: number, fromIso?: string,
): Promise<Record<string, number>> {
  const today = new Date();
  const toDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const data = await postJson<{ data: { navDate: string; nav?: number }[] }>(
    FMARKET_NAV_HISTORY_URL,
    { isAllData: 0, productId, fromDate: fromIso?.replaceAll("-", "") ?? HISTORY_FROM, toDate },
  );
  const out: Record<string, number> = {};
  // fmarket's navDate is the *report* date; the value is the previous trading day's NAV.
  for (const r of data.data ?? []) if (r.nav) out[prevTradingDayIso(r.navDate)] = r.nav;
  return out;
}

// DCVFM (dragoncapital.com.vn) daily NAV series. Two DCVFM-intrinsic fix-ups (no
// cross-checking another source):
//   1. DCVFM labels every NAV one day EARLY — its dates run Sun–Thu, not Mon–Fri — so
//      +1 day recovers the report date it should carry (Sun→Mon).
//   2. That report date's value is the previous trading day's valuation (funds report
//      T+1), so prevTradingDayIso maps it to the true valuation date for the P&L calendar.
// `getFundData` (the live source) bakes the fund's { fundCode, fundReportCode } into its
// URL params; we reuse those here so the strategy works for any DC fund without config.
const DCVFM_HISTORY_URL =
  "https://www.dragoncapital.com.vn/individual/vi/webruntime/api/apex/execute?cacheable=true&classname=%40udd%2F01pJ2000000CgSu&isContinuation=false&method=getFundRelatedDataByDateRange&namespace=&language=vi&asGuest=true&htmlEncode=false";
const DCVFM_SITE_ID = "0DMJ2000000oLukOAE";

/** Pull { fundCode, fundReportCode } out of a getFundData source URL's `params` blob. */
export function parseDcvfmCodes(url: string): { fundCode: string; fundReportCode: string } | null {
  try {
    const raw = new URL(url).searchParams.get("params");
    if (!raw) return null;
    const p = JSON.parse(raw) as { fundCode?: string; fundReportCode?: string };
    if (p.fundCode && p.fundReportCode) return { fundCode: p.fundCode, fundReportCode: p.fundReportCode };
  } catch {
    // Not a DCVFM getFundData URL — caller reports the miss.
  }
  return null;
}

export async function fetchDcvfmNavHistory(
  fundCode: string, fundReportCode: string, fromIso?: string,
): Promise<Record<string, number>> {
  const from =
    fromIso ?? `${HISTORY_FROM.slice(0, 4)}-${HISTORY_FROM.slice(4, 6)}-${HISTORY_FROM.slice(6, 8)}`;
  const params = JSON.stringify({
    endDateIsoString: `${todayIso()}T23:59:59.000Z`,
    fundCode, fundReportCode,
    orderBy: "navDate__c", orderDirection: "desc",
    pageNumber: 1, pageSize: 1000,
    siteId: DCVFM_SITE_ID, startDateIsoString: from,
  });
  const data = await getJson<{ returnValue?: { navDate__c?: string; navPerShare__c?: number }[] }>(
    `${DCVFM_HISTORY_URL}&params=${encodeURIComponent(params)}`,
  );
  const out: Record<string, number> = {};
  for (const r of data.returnValue ?? []) {
    if (!r.navDate__c || !r.navPerShare__c) continue;
    // +1 recovers the report date (DCVFM is a day early); prevTradingDay → valuation date.
    const date = prevTradingDayIso(isoAddDays(r.navDate__c.slice(0, 10), 1));
    out[date] = r.navPerShare__c;
  }
  return out;
}

/** Pull each price-tracked instrument's daily series and upsert it.
 *  `lookbackDays` null = the full backfill from HISTORY_FROM; a number narrows every
 *  fetch to roughly that many days back, which is all a just-published close/NAV needs
 *  and cheap enough to run on demand. Upserts either way, so a narrow window can only
 *  add or correct recent days — it never drops the deep history already stored. */
async function fetchHistoryInto(lookbackDays: number | null): Promise<[number, string[]]> {
  const fromIso = lookbackDays == null ? undefined : isoAddDays(todayIso(), -lookbackDays);
  let updated = 0;
  const errors: string[] = [];
  let fmIds: Record<string, number> | null = null;

  const [instruments, sources] = await Promise.all([listInstruments(), priceSourceMap()]);
  for (const row of instruments) {
    if (!row.price_source || row.price_source === MANUAL_SOURCE) continue;
    // Sold out: the closes already stored keep the chart's history intact, and no day from
    // here on can be worth anything, so there is nothing left to fetch. This is the
    // expensive one — a full backfill pulls years of daily bars per holding.
    if (isDormant(row)) continue;
    const src = sources.get(row.price_source);
    const strat = src?.history_strategy ?? "none";
    if (strat === "none") continue;
    try {
      let history: Record<string, number> | null = null;
      if (strat === "yahoo" && row.symbol)
        history = await fetchYahooHistory(row.symbol, yahooRange(lookbackDays));
      else if (strat === "entrade" && row.symbol)
        history = await fetchEntradeHistory(row.symbol, fromIso);
      else if (strat === "coingecko" && row.symbol)
        history = await fetchCoingeckoHistory(row.symbol, lookbackDays ?? 365);
      else if (strat === "fmarket") {
        if (!fmIds) {
          fmIds = {};
          for (const r of await fmarketRows()) fmIds[r.shortName] = r.id;
        }
        const pid = fmIds[row.symbol ?? row.name];
        if (pid) history = await fetchFmarketNavHistory(pid, fromIso);
        else errors.push(`${row.name}: not found on fmarket`);
      }
      else if (strat === "dcvfm") {
        const codes = src ? parseDcvfmCodes(src.url) : null;
        if (codes)
          history = await fetchDcvfmNavHistory(codes.fundCode, codes.fundReportCode, fromIso);
        else errors.push(`${row.name}: cannot read DCVFM fund codes from source URL`);
      }
      if (history && Object.keys(history).length) {
        await upsertPriceHistory(row.name, history);
        updated += 1;
      }
    } catch (e) {
      errors.push(`${row.name}: ${(e as Error).message}`);
    }
  }
  return [updated, errors];
}

/** Yahoo takes a range keyword, not a date — widen to the smallest one that covers
 *  `lookbackDays` (plus a weekend, so a Monday still reaches Friday's close). */
function yahooRange(lookbackDays: number | null): string {
  if (lookbackDays == null) return "2y";
  if (lookbackDays <= 5) return "5d";
  if (lookbackDays <= 30) return "1mo";
  return "3mo";
}

/** How soon a backfill that hit an error may be tried again. Short enough that a
 *  transient upstream failure costs minutes rather than the full `maxAgeHours`, long
 *  enough that a permanently-broken holding can't turn the 5-minute cron into a
 *  hammer on the upstream feeds. */
const HISTORY_RETRY_MINUTES = 30;

/** The full backfill, at most every maxAgeHours. Each source's `history_strategy`
 *  selects which built-in fetcher to use.
 *
 *  Two clocks, because there are two things worth remembering. `history_fetched_at` is
 *  advanced only by a run that actually stored something, and is what holds the 12h gate
 *  shut; `history_attempted_at` is advanced by every run and only paces the retries.
 *  Stamping the first one unconditionally — as this used to — meant a backfill where every
 *  single fetch failed still bought twelve hours of silence, so a day that was stored wrong
 *  stayed wrong until someone noticed. `fetchHistoryInto` collects failures rather than
 *  throwing, so a totally failed run is indistinguishable from a good one unless its
 *  result is read.
 *
 *  The bar is "stored something", not "no errors": one permanently unreachable feed must
 *  not condemn the other nine to a full re-fetch every half hour forever. A run that got
 *  nothing at all is the one worth retrying soon, and it is the only one that keeps the
 *  gate open. */
export async function refreshHistory(maxAgeHours = 12): Promise<[number, string[]]> {
  const [last, attempted] = await Promise.all([
    metaGet("history_fetched_at"),
    metaGet("history_attempted_at"),
  ]);
  const now = Date.now();
  if (last && now - new Date(last).getTime() < maxAgeHours * 3600 * 1000) return [0, []];
  // `maxAgeHours === 0` is the "Rebuild history" button asking for it now — the retry
  // pacing is for unattended cron ticks and must not stand in the user's way.
  if (
    maxAgeHours > 0 &&
    attempted &&
    now - new Date(attempted).getTime() < HISTORY_RETRY_MINUTES * 60 * 1000
  )
    return [0, []];

  await metaSet("history_attempted_at", new Date().toISOString());
  const res = await fetchHistoryInto(null);
  if (res[0] > 0) await metaSet("history_fetched_at", new Date().toISOString());
  return res;
}

/** The last few days only — for a manual price refresh, where waiting up to 12h for a
 *  close that has already been published is the whole complaint. Deliberately does NOT
 *  stamp `history_fetched_at`: that key gates the full backfill, and a narrow fetch must
 *  never convince it that the deep history is up to date. */
export async function refreshRecentHistory(days = 2): Promise<[number, string[]]> {
  return fetchHistoryInto(days);
}

/** How often the cron sweeps the last few days. The full backfill's 12h gate is right for
 *  years of candles but far too coarse for the newest one: a close published just after a
 *  sweep would otherwise wait up to twelve hours to land, and until it did, that day sat
 *  in the chart carrying the previous day's price. */
const RECENT_SWEEP_MINUTES = 30;

/** The cron's catch-up pass: pick up closes and NAVs that have settled since the last
 *  sweep. Narrow (a few days, so a handful of requests) and throttled, so running it on
 *  every five-minute tick is cheap. Like `refreshRecentHistory` it never touches
 *  `history_fetched_at` — the deep backfill's gate is not its to open. */
export async function sweepRecentHistory(days = 4): Promise<[number, string[]]> {
  const last = await metaGet("recent_swept_at");
  if (last && Date.now() - new Date(last).getTime() < RECENT_SWEEP_MINUTES * 60 * 1000)
    return [0, []];
  await metaSet("recent_swept_at", new Date().toISOString());
  return refreshRecentHistory(days);
}
