/**
 * Land listings near a point, from Nhà Tốt (Chợ Tốt's property site). Server-only.
 *
 * This is the public JSON feed nhatot.com's own pages call — undocumented, unversioned and
 * free to change under us, so everything here is defensive: an unknown field drops the
 * listing rather than guessing, and a failed request comes back as an error string, never a
 * throw. It runs when you press "Find listings nearby", when you save a plot with auto-comps
 * on, and once a day from the cron for plots that have them (`refreshAutoCompsScheduled`).
 *
 * What it answers is *asking* prices. They become `kind: "asking"` comps, which the estimate
 * already discounts (`ASKING_DISCOUNT` in `lib/realestate.ts`).
 */
import {
  listComps, listProperties, metaGet, metaSet, replaceAutoComps,
} from "./db";
import { distanceKm, type LatLng } from "./realestate";
import type { CompInput, LandUse, RoadAccess } from "./types";

const FEED = "https://gateway.chotot.com/v1/public/ad-listing";
/** Chợ Tốt's category for land (Đất). */
const LAND_CATEGORY = 1040;
/** The feed's page size ceiling — asking for more still returns 50. */
const PAGE = 50;
/** Enough for any sensible radius; 10 km around Long Điền is ~130 listings. */
const MAX_PAGES = 6;

/** A listing, already in the shape of a comp. */
export interface Listing {
  /** Chợ Tốt's `list_id` — stable across edits, so it's the dedupe key (via `url`). */
  id: number;
  url: string;
  title: string;
  lat: number;
  lng: number;
  distanceKm: number;
  price: number;
  area_m2: number;
  date: string;
  land_use: LandUse;
  access: RoadAccess;
  /** The ward/district, for telling two listings on the same street apart. */
  place: string;
}

export function listingUrl(id: number): string {
  return `https://www.nhatot.com/${id}.htm`;
}

/** The raw fields we read. Everything is optional — it's someone else's API. */
interface RawAd {
  list_id?: number;
  type?: string;
  subject?: string;
  price?: number;
  size?: number;
  latitude?: number;
  longitude?: number;
  list_time?: number;
  land_type?: number;
  pty_characteristics?: number[];
  is_price_not_valid?: boolean;
  ward_name?: string;
  area_name?: string;
}

// `land_type`: 1 Đất thổ cư, 2 Đất nền dự án, 3 Đất công nghiệp, 4 Đất nông nghiệp.
// `pty_characteristics` (several at once): 1 Mặt tiền, 2 Hẻm xe hơi, 3 Nở hậu,
// 4 Chưa có thổ cư, 5 Thổ cư 1 phần, 6 Thổ cư toàn bộ, 7 Không có thổ cư.
// Read off the feed's own labels (`/ad-listing/<id>` → `parameters`) in September 2026.

/** How much of the plot is residential decides the market it's in. The characteristics say
 *  it more precisely than `land_type`, so they win; industrial land is no comp for anything
 *  here and is dropped. */
function landUseOf(ad: RawAd): LandUse | null {
  const c = ad.pty_characteristics ?? [];
  if (c.includes(6)) return "residential";
  if (c.includes(5)) return "mixed";
  if (c.includes(4) || c.includes(7)) return "agricultural";
  if (ad.land_type === 1 || ad.land_type === 2) return "residential";
  if (ad.land_type === 4) return "agricultural";
  return null;
}

/** Street front if it says so; otherwise an alley, which is what most plots are. The feed
 *  has no way to say "no road at all", so that's never inferred. */
function accessOf(ad: RawAd): RoadAccess {
  return ad.pty_characteristics?.includes(1) ? "street" : "alley";
}

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
});

function toListing(ad: RawAd, at: LatLng): Listing | null {
  const { list_id: id, price, size, latitude: lat, longitude: lng, list_time } = ad;
  if (!id || !price || !size || lat == null || lng == null || !list_time) return null;
  if (ad.type !== "s" || ad.is_price_not_valid) return null;
  // Placeholder prices ("1 đồng, call me") and plots too small to be real.
  if (price < 10_000_000 || size < 10) return null;
  const land_use = landUseOf(ad);
  if (!land_use) return null;
  return {
    id,
    url: listingUrl(id),
    title: (ad.subject ?? "").trim() || `Listing ${id}`,
    lat,
    lng,
    distanceKm: distanceKm(at, { lat, lng }),
    price: Math.round(price),
    area_m2: size,
    date: dayFormatter.format(new Date(list_time)),
    land_use,
    access: accessOf(ad),
    place: [ad.ward_name, ad.area_name].filter(Boolean).join(", "),
  };
}

/**
 * Every land listing within `radiusKm` of `at`, nearest first.
 *
 * The feed takes a whole-km radius, so it's asked for the ceiling and the result trimmed to
 * the exact one here — the same distance the estimate itself uses.
 */
export async function nearbyListings(
  at: LatLng,
  radiusKm: number,
): Promise<{ ok: true; listings: Listing[] } | { ok: false; message: string }> {
  const out = new Map<number, Listing>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(FEED);
    url.search = new URLSearchParams({
      cg: String(LAND_CATEGORY),
      st: "s,k",
      latitude: String(at.lat),
      longitude: String(at.lng),
      distance: String(Math.max(1, Math.ceil(radiusKm))),
      limit: String(PAGE),
      o: String(page * PAGE),
    }).toString();
    let ads: RawAd[];
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) return { ok: false, message: `Nhà Tốt answered ${res.status}.` };
      // The feed puts raw control characters inside listing text, which strict JSON
      // refuses; they carry nothing we read, so they're blanked before parsing.
      const text = (await res.text()).replace(/[\u0000-\u001f]/g, " ");
      ads = (JSON.parse(text) as { ads?: RawAd[] }).ads ?? [];
    } catch {
      return { ok: false, message: "Couldn't reach Nhà Tốt. Try again in a moment." };
    }
    for (const ad of ads) {
      const l = toListing(ad, at);
      if (l && l.distanceKm < radiusKm) out.set(l.id, l);
    }
    if (ads.length < PAGE) break;
  }
  return { ok: true, listings: [...out.values()].sort((a, b) => a.distanceKm - b.distanceKm) };
}

/** A listing as the comp it becomes — always an asking price. */
export function listingComp(l: Listing): CompInput {
  return {
    lat: l.lat, lng: l.lng, area_m2: l.area_m2, price: l.price, date: l.date,
    kind: "asking", land_use: l.land_use, access: l.access,
    label: l.title.slice(0, 80), source: l.url, note: l.place || null,
  };
}

/**
 * For every plot with auto-comps on (or just `only`), replace the comps its refresh owns
 * with the `auto_comps` nearest listings of the same land use (less any already kept).
 *
 * Replaced, not appended: the set is "the N nearest listed right now", so a listing taken
 * down drops out and a closer new one takes its place. A comp you added or ticked in
 * yourself is never touched, and one of the N that's already one of the plot's comps isn't
 * added twice. If the search fails the old set stays; a Nhà Tốt outage costs freshness,
 * not evidence.
 *
 * One upstream search and one batched write per plot. That's a loop with I/O in it, but
 * each plot is its own search around its own pin, so there's no single query to fold it into.
 */
export async function refreshAutoComps(only?: string): Promise<string[]> {
  const [properties, comps] = await Promise.all([listProperties(), listComps()]);
  const targets = properties.filter((p) => p.auto_comps > 0 && (!only || p.instrument === only));
  const errors: string[] = [];
  for (const p of targets) {
    const found = await nearbyListings(p, p.radius_km);
    if (!found.ok) {
      errors.push(`${p.instrument}: ${found.message}`);
      continue;
    }
    // This plot's own hand-kept comps. Another plot's comps are no concern of this one's —
    // comps aren't shared, so the same listing may well be evidence for both.
    const taken = new Set(
      comps.filter((c) => c.instrument === p.instrument && c.auto_for == null).map((c) => c.source),
    );
    // The N nearest first, *then* drop the ones already kept: a listing you ticked in by
    // hand is one of the N and already counts, so it isn't replaced by one further out.
    const nearest = found.listings
      .filter((l) => l.land_use === p.land_use)
      .slice(0, p.auto_comps)
      .filter((l) => !taken.has(l.url));
    await replaceAutoComps(p.instrument, nearest.map(listingComp));
  }
  return errors;
}

/** Listings move slowly; once a day is plenty, and keeps us a light user of a feed we
 *  have no agreement with. */
const AUTO_COMPS_MAX_AGE_MS = 24 * 3_600_000;

/** The cron's entry point: `refreshAutoComps`, at most once a day. The stamp is written
 *  before the refresh, so a failing feed is retried tomorrow rather than every minute. */
export async function refreshAutoCompsScheduled(): Promise<string[]> {
  const at = await metaGet("comps_refreshed_at");
  if (at && Date.now() - Date.parse(at + "Z") < AUTO_COMPS_MAX_AGE_MS) return [];
  await metaSet("comps_refreshed_at", new Date().toISOString().slice(0, 19));
  return (await refreshAutoComps()).map((e) => `auto-comps ${e}`);
}
