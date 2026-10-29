/**
 * The holding form's symbol search: what to type in the Symbol field, looked up for the
 * feed the holding will be priced from. Server-only.
 *
 * Searches run against `symbol_catalog` in D1, which `syncSymbolCatalogs` refills once a day
 * from the cron — so typing never calls a feed. A source gets a catalog when its feed can
 * list everything it quotes:
 *  - a batch source that answers with its whole list (`listsItsSymbols`: PNJ's gold board,
 *    fmarket's funds);
 *  - a CoinGecko source, from CoinGecko's top coins by market cap.
 * Yahoo has no such list — there is no endpoint for "every ticker" — so a Yahoo source is
 * the one that still searches live, through Yahoo's own ticker search. Anything else can't
 * be looked up at all, and the field stays free text.
 *
 * Sources are told apart by what they fetch, not their key, so a copied or hand-made
 * source behaves like the built-in it copies.
 */
import { catalogSize, listPriceSources, metaGet, metaSet, replaceSymbolCatalog, searchSymbolCatalog } from "./db";
import { listSourceSymbols, listsItsSymbols } from "./prices";
import { SYMBOL_NAMES, type PriceSource, type SymbolHit, type SymbolPage } from "./types";

export const SYMBOL_PAGE_SIZE = 8;

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const SYNCED_AT_KEY = "symbols_synced_at";

/** CoinGecko's top coins by market cap, in pages of 250. A thousand covers anything you're
 *  likely to hold; a coin outside it can still be typed in by its id. */
const GECKO_PAGES = 4;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

const isYahoo = (src: PriceSource) => /finance\.yahoo\.com/.test(src.url);
const isGecko = (src: PriceSource) => /api\.coingecko\.com/.test(src.url);

interface GeckoMarket {
  id?: string;
  name?: string;
  symbol?: string;
  market_cap_rank?: number | null;
}

/** Everything a source can quote, for its catalog — or null when it can't list it. */
function catalogFetcher(src: PriceSource): (() => Promise<SymbolHit[]>) | null {
  if (listsItsSymbols(src)) {
    const names = SYMBOL_NAMES[src.key] ?? {};
    return async () =>
      (await listSourceSymbols(src)).map(({ symbol }) => ({ symbol, label: names[symbol] ?? null, detail: null }));
  }
  if (isGecko(src))
    return async () => {
      const pages = await Promise.all(
        Array.from({ length: GECKO_PAGES }, (_, i) =>
          getJson<GeckoMarket[]>(
            `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${i + 1}`,
          ),
        ),
      );
      return pages.flat().flatMap((c) =>
        c.id
          ? [{
              symbol: c.id,
              label: c.name ?? null,
              detail: [c.symbol?.toUpperCase(), c.market_cap_rank ? `#${c.market_cap_rank}` : null]
                .filter(Boolean).join(" · ") || null,
            }]
          : [],
      );
    };
  return null;
}

async function syncOne(src: PriceSource): Promise<void> {
  const fetcher = catalogFetcher(src);
  if (!fetcher) return;
  const rows = await fetcher();
  // An empty answer is a feed having a bad day, not every symbol being delisted at once;
  // taking it literally would empty the catalog until tomorrow.
  if (!rows.length) throw new Error("the feed listed nothing");
  await replaceSymbolCatalog(src.key, rows);
}

/** Refill every source's catalog, at most once a day. Stamped before fetching, so a feed
 *  that's down is retried tomorrow rather than every minute; its catalog keeps what it had. */
export async function syncSymbolCatalogs(maxAgeHours = 24): Promise<string[]> {
  const last = await metaGet(SYNCED_AT_KEY);
  if (last && Date.now() - new Date(last).getTime() < maxAgeHours * 3600 * 1000) return [];
  await metaSet(SYNCED_AT_KEY, new Date().toISOString());
  const errors: string[] = [];
  for (const src of await listPriceSources()) {
    try {
      await syncOne(src);
    } catch (e) {
      errors.push(`${src.label}: symbol list: ${(e as Error).message}`);
    }
  }
  return errors;
}

interface YahooQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  typeDisp?: string;
}

async function yahooSearch(q: string, want: number): Promise<SymbolHit[]> {
  const data = await getJson<{ quotes?: YahooQuote[] }>(
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}` +
      `&quotesCount=${want}&newsCount=0&listsCount=0`,
  );
  return (data.quotes ?? []).flatMap((x) =>
    x.symbol
      ? [{
          symbol: x.symbol,
          label: x.shortname ?? x.longname ?? null,
          detail: [x.exchDisp, x.typeDisp].filter(Boolean).join(" · ") || null,
        }]
      : [],
  );
}

/** Page `page` (from 0) of the hits for `q`. One more hit than the page is asked for, so
 *  `hasMore` is known without a second query. */
export async function symbolPage(src: PriceSource, q: string, page: number): Promise<SymbolPage> {
  const offset = page * SYMBOL_PAGE_SIZE;
  try {
    let hits: SymbolHit[];
    if (catalogFetcher(src)) {
      // Before the cron's first sync — a source added today, or a fresh local database —
      // the catalog is filled on the spot rather than leaving the search empty until tomorrow.
      if (page === 0 && (await catalogSize(src.key)) === 0) await syncOne(src);
      hits = await searchSymbolCatalog(src.key, q, SYMBOL_PAGE_SIZE + 1, offset);
    } else if (isYahoo(src)) {
      // Yahoo lists nothing for an empty query, and has no offset: ask for everything up to
      // the end of this page and keep the last page's worth.
      hits = q ? (await yahooSearch(q, offset + SYMBOL_PAGE_SIZE + 1)).slice(offset) : [];
    } else {
      return { items: [], hasMore: false, searchable: false };
    }
    return { items: hits.slice(0, SYMBOL_PAGE_SIZE), hasMore: hits.length > SYMBOL_PAGE_SIZE, searchable: true };
  } catch (e) {
    return { items: [], hasMore: false, searchable: true, error: (e as Error).message };
  }
}
