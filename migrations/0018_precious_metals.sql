-- Precious metals: gold priced at what a Vietnamese dealer pays you for it.
--
-- `price_multiplier` scales whatever a source extracts into whole VND. Every feed so far
-- quoted VND outright; PNJ's gold board quotes thousands of ₫ per chỉ, so its rows are ×1000.
-- Defaulting to 1 keeps every existing source exactly as it was, and an old Worker that
-- never reads the column is unaffected during the deploy gap.
ALTER TABLE price_sources ADD COLUMN price_multiplier REAL NOT NULL DEFAULT 1;

-- PNJ's public board (the one pnj.com.vn draws its price table from): one request returns
-- every product as `{ data: [{ masp, tensp, giamua, giaban }], updateDate }`. A holding's
-- symbol is its `masp`: `SJC` for SJC bars, `N24K` for PNJ's plain 9999 ring. `giamua` is
-- what PNJ pays you — the buy-back price, and so the honest value of metal you hold.
-- zone=00 is Ho Chi Minh City. Unlike sjc.com.vn, which only answers Vietnamese IPs, this
-- answers wherever the Worker runs.
--
-- History `daily`: the board has no history, so the live price is kept as each day's close
-- from the first refresh on.
INSERT OR IGNORE INTO price_sources
  (key, label, kind, method, url, body, batch, rows_path, key_field,
   price_field, price_path, price_regex, history_strategy, price_multiplier, builtin, created_at)
VALUES
  ('pnj_gold', 'PNJ gold (buy-back, ₫/chỉ)', 'json', 'GET',
   'https://edge-api.pnj.io/ecom-frontend/v1/get-gold-price?zone=00',
   NULL, 1, 'data', 'masp', 'giamua', NULL, NULL, 'daily', 1000, 1, datetime('now'));
