-- When a Nhà Tốt comp's listing was found gone on a price refresh.
--
-- Kept, not deleted: a listing that comes down has often sold, near its last ask, so it's
-- still evidence. It just stops being refreshed, and so ages like any other comp. NULL =
-- still listed as of the last refresh (or not a listing at all). A listing that turns up
-- again is cleared back to NULL.
--
-- Additive: one nullable column the old Worker never reads.

ALTER TABLE property_comps ADD COLUMN delisted_on TEXT;
