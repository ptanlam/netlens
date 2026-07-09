/**
 * Live + historical price fetching. Ported from the Flask version's prices.py.
 * - Crypto  -> CoinGecko (VND directly; symbol = coin id, e.g. "bitcoin")
 * - Stocks  -> Yahoo Finance (symbol = ticker, e.g. "FPT.VN")
 * - DCDS    -> fmarket.vn fund API (symbol = shortName)
 * - VCBF-TBF-> scraped from vcbf.com
 * Failures are collected, never thrown, so one bad ticker can't break a refresh.
 */
import {
  getDb, listInstruments, updatePrice, upsertPriceHistory, metaGet, metaSet,
} from "./db";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const FMARKET_URL = "https://api.fmarket.vn/res/products/filter";
const FMARKET_NAV_HISTORY_URL = "https://api.fmarket.vn/res/product/get-nav-history";
const VCBF_TBF_URL =
  "https://www.vcbf.com/quy-mo/cac-quy-mo/quy-dau-tu-can-bang-chien-luoc-vcbf/";
const HISTORY_FROM = "20250101";

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

function isoFromEpoch(seconds: number): string {
  const d = new Date(seconds * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- live prices ----------

export async function fetchCoingeckoVnd(ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {};
  const data = await getJson<Record<string, { vnd?: number }>>(
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent([...new Set(ids)].sort().join(","))}&vs_currencies=vnd`,
  );
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(data)) if (v?.vnd) out[k] = v.vnd;
  return out;
}

export async function fetchYahooVnd(symbol: string): Promise<number | null> {
  const data = await getJson<{
    chart: { result?: { meta?: { regularMarketPrice?: number } }[] };
  }>(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`);
  return data.chart.result?.[0]?.meta?.regularMarketPrice ?? null;
}

interface FmarketRow { id: number; shortName: string; nav?: number }

async function fmarketRows(): Promise<FmarketRow[]> {
  const data = await postJson<{ data: { rows: FmarketRow[] } }>(FMARKET_URL, {
    types: ["NEW_FUND", "TRADING_FUND"], page: 1, pageSize: 100,
  });
  return data.data?.rows ?? [];
}

export async function fetchFmarketNavs(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const r of await fmarketRows()) if (r.nav) out[r.shortName] = r.nav;
  return out;
}

export async function fetchVcbfTbfNav(): Promise<number | null> {
  const res = await fetch(VCBF_TBF_URL, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/"tbf_data"\s*:\s*\{.*?"price"\s*:\s*"([\d.,]+)"/);
  return m ? parseFloat(m[1].replace(/,/g, "")) : null;
}

/** Fetch live prices for every auto-priced instrument. Returns [updated, errors]. */
export async function refreshAll(): Promise<[number, string[]]> {
  const instruments = listInstruments();
  let updated = 0;
  const errors: string[] = [];

  const cg = instruments.filter((r) => r.price_source === "coingecko" && r.symbol);
  if (cg.length) {
    try {
      const prices = await fetchCoingeckoVnd(cg.map((r) => r.symbol!));
      for (const r of cg) {
        if (prices[r.symbol!]) { updatePrice(r.name, prices[r.symbol!]); updated += 1; }
        else errors.push(`${r.name}: no CoinGecko price for '${r.symbol}'`);
      }
    } catch (e) { errors.push(`CoinGecko: ${(e as Error).message}`); }
  }

  for (const r of instruments.filter((r) => r.price_source === "yahoo" && r.symbol)) {
    try {
      const price = await fetchYahooVnd(r.symbol!);
      if (price) { updatePrice(r.name, price); updated += 1; }
      else errors.push(`${r.name}: no Yahoo price for '${r.symbol}'`);
    } catch (e) { errors.push(`${r.name}: ${(e as Error).message}`); }
  }

  const fm = instruments.filter((r) => r.price_source === "fmarket");
  if (fm.length) {
    try {
      const navs = await fetchFmarketNavs();
      for (const r of fm) {
        const short = r.symbol ?? r.name;
        if (navs[short]) { updatePrice(r.name, navs[short]); updated += 1; }
        else errors.push(`${r.name}: no fmarket NAV for '${short}'`);
      }
    } catch (e) { errors.push(`fmarket: ${(e as Error).message}`); }
  }

  for (const r of instruments.filter((r) => r.price_source === "vcbf")) {
    try {
      const nav = await fetchVcbfTbfNav();
      if (nav) { updatePrice(r.name, nav); updated += 1; }
      else errors.push(`${r.name}: VCBF NAV not found`);
    } catch (e) { errors.push(`${r.name}: ${(e as Error).message}`); }
  }

  return [updated, errors];
}

// ---------- daily price history (for the P&L-over-time chart) ----------

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

/** Fetch daily history for every price-tracked instrument, at most every maxAgeHours. */
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
    try {
      let history: Record<string, number> | null = null;
      if (row.price_source === "yahoo" && row.symbol)
        history = await fetchYahooHistory(row.symbol);
      else if (row.price_source === "coingecko" && row.symbol)
        history = await fetchCoingeckoHistory(row.symbol);
      else if (row.price_source === "fmarket" || row.price_source === "vcbf") {
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
