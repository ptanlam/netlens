-- What the holding form's Symbol field searches: every symbol a price source can quote,
-- copied in by a daily sync (`syncSymbolCatalogs`) so typing searches D1 instead of calling
-- a feed on every keystroke. A cache, not records: the sync rewrites it, deleting a price
-- source deletes its rows, and backups carry the table's schema but not its rows.
CREATE TABLE IF NOT EXISTS symbol_catalog (
  source TEXT NOT NULL,   -- price_sources.key
  symbol TEXT NOT NULL,   -- what's saved as instruments.symbol
  label  TEXT,            -- a readable name, where the feed (or SYMBOL_NAMES) has one
  detail TEXT,            -- a second line: ticker, market-cap rank
  position INTEGER NOT NULL DEFAULT 0,  -- the feed's own order (CoinGecko's is market cap)
  PRIMARY KEY (source, symbol)
);
