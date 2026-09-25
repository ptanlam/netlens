-- Comps belong to one plot.
--
-- They were shared: a comp was a fact about the world, and every plot within its reach
-- counted it. In practice each comp is gathered *for* a plot — ticked in from a search around
-- its pin, judged against its land — and one plot's evidence turning up in another's estimate
-- was a surprise rather than a feature. `instrument` is the plot a comp is evidence for.
--
-- Existing comps go to the nearest placed plot. Squared degrees rather than true distance:
-- SQLite has no trig here, and ranking plots by nearness only needs the order, which a few km
-- of flat-earth error doesn't change. An auto comp already names its plot in `auto_for`. A
-- comp with no plot placed anywhere stays NULL and shows up nowhere until one is.
--
-- `auto_for` keeps its meaning (non-NULL = the daily refresh owns this row) and from here on
-- always equals `instrument` when set.
--
-- Additive: a nullable column, a backfill and an index. The old Worker never reads the
-- column, and a comp it inserts in the gap simply stays unowned.

ALTER TABLE property_comps ADD COLUMN instrument TEXT;

UPDATE property_comps SET instrument = auto_for WHERE auto_for IS NOT NULL;

-- A WHERE against the minimum rather than ORDER BY … LIMIT 1: SQLite won't let the outer row
-- into a subquery's ORDER BY. A tie goes to the first plot by name.
UPDATE property_comps SET instrument = (
  SELECT p.instrument FROM properties p
  WHERE (p.lat - property_comps.lat) * (p.lat - property_comps.lat)
      + (p.lng - property_comps.lng) * (p.lng - property_comps.lng) = (
    SELECT MIN((q.lat - property_comps.lat) * (q.lat - property_comps.lat)
             + (q.lng - property_comps.lng) * (q.lng - property_comps.lng))
    FROM properties q
  )
  ORDER BY p.instrument LIMIT 1
) WHERE instrument IS NULL;

CREATE INDEX IF NOT EXISTS idx_property_comps_instrument ON property_comps(instrument);
