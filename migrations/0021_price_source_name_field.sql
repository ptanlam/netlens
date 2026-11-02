-- A batch source can name what it quotes: `name_field` is the row field holding a product's
-- own name (PNJ's `tensp`, "Nhẫn Trơn PNJ 999.9"), which the symbol search shows and the
-- holding form fills the Name with. It replaces a hand-kept table of English names for
-- PNJ's codes. Additive: an old Worker never reads it.
ALTER TABLE price_sources ADD COLUMN name_field TEXT;
UPDATE price_sources SET name_field = 'tensp'
  WHERE url LIKE 'https://edge-api.pnj.io/%' AND name_field IS NULL;
-- symbol_catalog is a cache: emptied, PNJ's is refilled with the names on its next search.
DELETE FROM symbol_catalog
  WHERE source IN (SELECT key FROM price_sources WHERE name_field IS NOT NULL);
