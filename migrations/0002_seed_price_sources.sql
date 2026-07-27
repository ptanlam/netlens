-- The four price feeds ported from the Flask app, expressed as generic configs.
--
-- These used to be a TS array seeded on boot by `seedPriceSources()`, guarded by a
-- `price_sources_seeded` flag in `meta` so that built-ins the user had since *deleted*
-- weren't resurrected on every restart. A migration runs exactly once by construction, so
-- the flag is no longer load-bearing — it's still written below to keep the row present for
-- any code or eyeball that looks for it.
--
-- INSERT OR IGNORE, not REPLACE: importing a dump of the old SQLite database (see
-- docs/CLOUDFLARE.md) runs after this and carries the user's own edits to these rows.

INSERT OR IGNORE INTO price_sources
  (key, label, kind, method, url, body, batch, rows_path, key_field,
   price_field, price_path, price_regex, history_strategy, builtin, created_at)
VALUES
  ('coingecko', 'CoinGecko (crypto → VND)', 'json', 'GET',
   'https://api.coingecko.com/api/v3/simple/price?ids={symbols}&vs_currencies=vnd',
   NULL, 1, '', NULL, 'vnd', NULL, NULL, 'coingecko', 1, datetime('now')),

  ('yahoo', 'Yahoo Finance (ticker)', 'json', 'GET',
   'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1d',
   NULL, 0, NULL, NULL, NULL, 'chart.result.0.meta.regularMarketPrice', NULL, 'yahoo', 1, datetime('now')),

  ('fmarket', 'fmarket.vn (fund NAV)', 'json', 'POST',
   'https://api.fmarket.vn/res/products/filter',
   '{"types":["NEW_FUND","TRADING_FUND"],"page":1,"pageSize":100}',
   1, 'data.rows', 'shortName', 'nav', NULL, NULL, 'fmarket', 1, datetime('now')),

  ('vcbf', 'VCBF-TBF (scraped)', 'html', 'GET',
   'https://www.vcbf.com/quy-mo/cac-quy-mo/quy-dau-tu-can-bang-chien-luoc-vcbf/',
   NULL, 0, NULL, NULL, NULL, NULL,
   '"tbf_data"\s*:\s*\{.*?"price"\s*:\s*"([\d.,]+)"', 'fmarket', 1, datetime('now')),

  -- DCVFM DCDS fund — the dragoncapital.com.vn product page is a JS-rendered Salesforce
  -- SPA (no NAV in the raw HTML), but its guest Apex endpoint returns clean JSON, so we hit
  -- that directly instead of scraping. fundCode "VF1" + fundReportCode "DCDS" identify the
  -- fund; navPerShare__c is the NAV in whole VND. Both live NAV and history come from DCVFM
  -- (single-source, no cross-checking). DCVFM labels every NAV one day early (Sun–Thu
  -- instead of Mon–Fri), so the history fetcher shifts navDate +1 day to the true trading
  -- date — see fetchDcvfmNavHistory.
  ('dcvfm', 'DCVFM-DCDS (NAV)', 'json', 'GET',
   'https://www.dragoncapital.com.vn/individual/vi/webruntime/api/apex/execute?cacheable=true&classname=%40udd%2F01pJ2000000DF0h&isContinuation=false&method=getFundData&namespace=&params=%7B%22fundCode%22%3A%22VF1%22%2C%22fundReportCode%22%3A%22DCDS%22%7D&language=vi&asGuest=true&htmlEncode=false',
   NULL, 0, NULL, NULL, NULL, 'returnValue.latestFundData.navPerShare__c', NULL, 'dcvfm', 1, datetime('now'));

INSERT OR REPLACE INTO meta(key, value) VALUES ('price_sources_seeded', datetime('now'));
