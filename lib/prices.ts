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
  getDb, getPriceSource, listInstruments, updatePrice, upsertPriceHistory, metaGet, metaSet, todayIso,
} from "./db";
import type { Instrument, PriceSource } from "./types";
import { MANUAL_SOURCE } from "./types";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const FMARKET_URL = "https://api.fmarket.vn/res/products/filter";
const FMARKET_NAV_HISTORY_URL = "https://api.fmarket.vn/res/product/get-nav-history";
const HISTORY_FROM = "20250101";

function isoFromEpoch(seconds: number): string {
  const d = new Date(seconds * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

/** Fetch live prices for every auto-priced instrument. Returns [updated, errors]. */
export async function refreshAll(): Promise<[number, string[]]> {
  const priced = listInstruments().filter(
    (r) => r.price_source && r.price_source !== MANUAL_SOURCE,
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
    const src = getPriceSource(key);
    if (!src) {
      errors.push(`${rows.length} holding(s): unknown price source '${key}'`);
      continue;
    }
    try {
      if (src.batch) {
        const symbols = [...new Set(rows.map((r) => r.symbol).filter(Boolean) as string[])].sort();
        const data = await callSource(src, { symbols: symbols.map(encodeURIComponent).join(",") });
        const prices = extractBatch(src, data);
        for (const r of rows) {
          const lookup = r.symbol ?? r.name;
          if (prices[lookup] != null) {
            updatePrice(r.name, prices[lookup]);
            upsertPriceHistory(r.name, { [today]: prices[lookup] });
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
              updatePrice(r.name, price);
              upsertPriceHistory(r.name, { [today]: price });
              updated += 1;
            }
            else errors.push(`${r.name}: no ${src.label} price`);
          } catch (e) { errors.push(`${r.name}: ${(e as Error).message}`); }
        }
      }
    } catch (e) { errors.push(`${src.label}: ${(e as Error).message}`); }
  }

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

export async function fetchYahooHistory(
  symbol: string, range = "2y",
): Promise<Record<string, number>> {
  const data = await getJson<{
    chart: {
      result?: {
        timestamp?: number[];
        indicators?: { quote?: { close?: (number | null)[] }[] };
      }[];
    };
  }>(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`);
  const result = data.chart.result?.[0];
  const stamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const out: Record<string, number> = {};
  stamps.forEach((ts, i) => { const c = closes[i]; if (c) out[isoFromEpoch(ts)] = c; });
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

export async function fetchFmarketNavHistory(productId: number): Promise<Record<string, number>> {
  const today = new Date();
  const toDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const data = await postJson<{ data: { navDate: string; nav?: number }[] }>(
    FMARKET_NAV_HISTORY_URL,
    { isAllData: 0, productId, fromDate: HISTORY_FROM, toDate },
  );
  const out: Record<string, number> = {};
  for (const r of data.data ?? []) if (r.nav) out[r.navDate] = r.nav;
  return out;
}

/** Fetch daily history for every price-tracked instrument, at most every maxAgeHours.
 *  Each source's `history_strategy` selects which built-in fetcher to use. */
export async function refreshHistory(maxAgeHours = 12): Promise<[number, string[]]> {
  getDb();
  const last = metaGet("history_fetched_at");
  if (last) {
    const age = Date.now() - new Date(last).getTime();
    if (age < maxAgeHours * 3600 * 1000) return [0, []];
  }

  let updated = 0;
  const errors: string[] = [];
  let fmIds: Record<string, number> | null = null;

  for (const row of listInstruments()) {
    if (!row.price_source || row.price_source === MANUAL_SOURCE) continue;
    const strat = getPriceSource(row.price_source)?.history_strategy ?? "none";
    if (strat === "none") continue;
    try {
      let history: Record<string, number> | null = null;
      if (strat === "yahoo" && row.symbol)
        history = await fetchYahooHistory(row.symbol);
      else if (strat === "coingecko" && row.symbol)
        history = await fetchCoingeckoHistory(row.symbol);
      else if (strat === "fmarket") {
        if (!fmIds) {
          fmIds = {};
          for (const r of await fmarketRows()) fmIds[r.shortName] = r.id;
        }
        const pid = fmIds[row.symbol ?? row.name];
        if (pid) history = await fetchFmarketNavHistory(pid);
        else errors.push(`${row.name}: not found on fmarket`);
      }
      if (history && Object.keys(history).length) {
        upsertPriceHistory(row.name, history);
        updated += 1;
      }
    } catch (e) {
      errors.push(`${row.name}: ${(e as Error).message}`);
    }
  }

  metaSet("history_fetched_at", new Date().toISOString());
  return [updated, errors];
}
