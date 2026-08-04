-- VN equity *history* moves from Yahoo to DNSE (services.entrade.com.vn).
--
-- Yahoo pads a HOSE session it doesn't have with a synthetic bar (open=high=low=close at
-- the previous close, volume 0) rather than omitting the day. Stored, that is a settled
-- close nobody traded at: the real session's move vanishes from its own day and is folded
-- into the next one. 2026-08-03 was exactly this — HOSE traded (HPG did 44M shares), Yahoo
-- reported nothing, and Monday's P&L read +₫348k instead of +₫10.3M.
--
-- Only `history_strategy` changes. The live-price URL and price_path stay on Yahoo, which
-- is accurate intraday and is what keeps today's card moving on every refresh — the column
-- exists precisely so the two can differ. Instruments keep price_source='yahoo' and their
-- "FPT.VN" symbols; the fetcher strips the .VN suffix for DNSE.
--
-- Scoped to the row still pointing at 'yahoo', so a hand-edited source is left alone.
UPDATE price_sources
   SET label            = 'Yahoo Finance (live) + DNSE (history)',
       history_strategy = 'entrade'
 WHERE key = 'yahoo'
   AND history_strategy = 'yahoo';
