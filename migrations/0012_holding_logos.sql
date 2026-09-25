-- A logo you upload for a holding.
--
-- The image lives in its own table, not on `instruments`: every page reads the instrument
-- list, and a few KB of image per row would ride along on all of them. `instruments.logo_at`
-- is the only trace there — NULL = no upload — and doubles as the cache-buster in the logo's
-- URL (`/api/logo/<name>?v=<logo_at>`), so the image itself can be cached for good.
--
-- `data` is a data: URL of a 96px square the browser drew before uploading (the same size
-- as the bundled marks in `public/logos/`), so a row is a few KB whatever was picked.
--
-- Additive: a nullable column and a new table, neither of which the old Worker reads.

ALTER TABLE instruments ADD COLUMN logo_at TEXT;

CREATE TABLE IF NOT EXISTS instrument_logos (
  instrument TEXT PRIMARY KEY,
  data       TEXT NOT NULL
);
