/**
 * Land listings near a point, from Nhà Tốt (Chợ Tốt's property site). Server-only.
 *
 * This is the public JSON feed nhatot.com's own pages call — undocumented, unversioned and
 * free to change under us, so everything here is defensive: an unknown field drops the
 * listing rather than guessing, and a failed request comes back as an error string, never a
 * throw. It runs only when you press "Find listings nearby" — never on a schedule — and
 * nothing becomes a comp until you tick it in.
 *
 * What it answers is *asking* prices. They become `kind: "asking"` comps, which the estimate
 * already discounts (`ASKING_DISCOUNT` in `lib/realestate.ts`).
 */
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

/** What a listing says today, looked up by id. */
export type ListingCheck =
  | { status: "listed"; price: number; area_m2: number }
  /** Taken down — Nhà Tốt answers 404, or the ad is no longer active. */
  | { status: "gone" }
  /** Couldn't tell: the request failed, or the ad has no usable price right now. */
  | { status: "unknown" };

async function checkListing(id: number): Promise<ListingCheck> {
  try {
    const res = await fetch(`${FEED}/${id}`, { headers: { accept: "application/json" } });
    if (res.status === 404) return { status: "gone" };
    if (!res.ok) return { status: "unknown" };
    const text = (await res.text()).replace(/[\u0000-\u001f]/g, " ");
    const ad = (JSON.parse(text) as { ad?: RawAd & { status?: string } }).ad;
    if (!ad) return { status: "unknown" };
    if (ad.status && ad.status !== "active") return { status: "gone" };
    const { price, size } = ad;
    if (!price || !size || ad.is_price_not_valid || price < 10_000_000 || size < 10) return { status: "unknown" };
    return { status: "listed", price: Math.round(price), area_m2: size };
  } catch {
    return { status: "unknown" };
  }
}

/** How many lookups run at once: quick for a plot's worth of comps, and polite to a feed we
 *  have no agreement with. */
const CHECK_CONCURRENCY = 6;

/** Each listing's current price, in `ids` order. One request per listing: the search feed
 *  can't be asked for particular ids, and only a direct lookup tells "taken down" apart
 *  from "moved outside the search radius". */
export async function checkListings(ids: number[]): Promise<ListingCheck[]> {
  const out: ListingCheck[] = [];
  for (let i = 0; i < ids.length; i += CHECK_CONCURRENCY) {
    out.push(...(await Promise.all(ids.slice(i, i + CHECK_CONCURRENCY).map(checkListing))));
  }
  return out;
}

/** A listing as the comp it becomes — always an asking price. */
export function listingComp(l: Listing): CompInput {
  return {
    lat: l.lat, lng: l.lng, area_m2: l.area_m2, price: l.price, date: l.date,
    kind: "asking", land_use: l.land_use, access: l.access,
    label: l.title.slice(0, 80), source: l.url, note: l.place || null,
  };
}
