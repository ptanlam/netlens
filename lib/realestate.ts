/**
 * What a plot of land is worth, from where it is. Pure — safe on client and server.
 *
 * This never fetches anything. It works from the comps you added to the plot — sales you
 * entered, or listings imported from Nhà Tốt by `lib/listings.ts` — and, if you keep one, an
 * area index. Every comp you added counts; none is dropped for being far or for making up
 * the numbers past some count.
 * It says how much evidence there was, because a valuation built on one listing is not the
 * same claim as one built on twenty sales.
 *
 * The method, in the order it runs:
 *
 * 1. **Score every comp** (`scoreComp`). Land use must match outright. Everything else only
 *    weighs: distance (half weight at the search radius, never zero), age (halving every
 *    `HALF_LIFE_YEARS`), road access and plot size. An asking price is cut by
 *    `ASKING_DISCOUNT` first, and an old comp is carried forward by the area index.
 * 2. **Take the weighted quartiles** of the comps' ₫/m² and multiply by your area. The
 *    middle is the estimate; the quartiles are the range — widened to at least
 *    `MIN_SPREAD / √n` either side, since one comp has no spread of its own to report.
 * 3. **Shrink toward what you paid** (`PRIOR_WEIGHT`), carried forward by the index when
 *    there is one. Two good comps get half the say; ten get most of it. That is the same
 *    conservatism as `lib/goals.ts` assuming 0% market return: thin evidence never moves
 *    net worth much on its own.
 *
 * Nothing here is stored. Correcting a comp or adding a sale rewrites the estimate on the
 * next render, the way the streak and the goal projections work.
 */
import type { Property, PropertyComp, PropertyIndexPoint } from "./types";

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365.25;

/** Listings in Vietnam ask roughly 10–20% above what land actually changes hands for. */
export const ASKING_DISCOUNT = 0.15;
/** A comp this many years old counts half as much as one from today. */
export const HALF_LIFE_YEARS = 2;
/** A comp on a different kind of road (street front vs alley) keeps this share of its weight. */
export const ACCESS_MISMATCH = 0.4;
/** How many comps' worth of say the prior (what you paid) keeps in the blend. */
export const PRIOR_WEIGHT = 2;
/** The range's half-width with a single comp; it narrows with √(effective comps). */
export const MIN_SPREAD = 0.25;

// ---------- location ----------

export interface LatLng {
  lat: number;
  lng: number;
}

function valid(lat: number, lng: number): LatLng | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * Coordinates from whatever a phone hands you: `10.4012, 107.2345`, or a Google Maps link.
 *
 * A place link carries two pairs — `@lat,lng` is where the *map* was centred, `!3dlat!4dlng`
 * is the pin itself — so the pin is tried first. A short `maps.app.goo.gl` link carries
 * neither until it's followed, which only the server can do (`resolveLocation` in
 * `app/actions.ts`); this returns null for it.
 */
export function parseLatLng(input: string): LatLng | null {
  const s = decodeURIComponent(input.trim());
  const pin = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (pin) return valid(Number(pin[1]), Number(pin[2]));
  const pair = s.match(/(-?\d{1,2}\.\d+)\s*[,;]\s*(-?\d{1,3}\.\d+)/);
  if (pair) return valid(Number(pair[1]), Number(pair[2]));
  return null;
}

export function fmtLatLng(p: LatLng): string {
  return `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
}

export function mapsUrl(p: LatLng): string {
  return `https://www.google.com/maps?q=${p.lat},${p.lng}`;
}

/** Great-circle distance in km. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** `to` relative to `from`, in km east (x) and north (y). Flat-earth, which is exact enough
 *  over the few km a comp radius spans — it's for drawing, not for weighting. */
export function offsetKm(from: LatLng, to: LatLng): { x: number; y: number } {
  const kmPerDeg = 111.32;
  return {
    x: (to.lng - from.lng) * kmPerDeg * Math.cos((from.lat * Math.PI) / 180),
    y: (to.lat - from.lat) * kmPerDeg,
  };
}

// ---------- area index ----------

/**
 * The index level on `date`, interpolated linearly between readings and held flat beyond
 * the first and last. Flat, not extrapolated: before your first reading the index knows
 * nothing, and inventing a trend there would be exactly the guess it exists to replace.
 */
export function indexAt(points: PropertyIndexPoint[], date: string): number | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  if (date <= sorted[0].date) return sorted[0].level;
  const last = sorted[sorted.length - 1];
  if (date >= last.date) return last.level;
  const t = Date.parse(date);
  const i = sorted.findIndex((p) => p.date > date);
  const a = sorted[i - 1];
  const b = sorted[i];
  const f = (t - Date.parse(a.date)) / (Date.parse(b.date) - Date.parse(a.date));
  return a.level + f * (b.level - a.level);
}

/** How much the area moved between two dates, as a multiplier. 1 with no index. */
export function indexFactor(points: PropertyIndexPoint[], from: string, to: string): number {
  const a = indexAt(points, from);
  const b = indexAt(points, to);
  if (a == null || b == null || a <= 0) return 1;
  return b / a;
}

// ---------- scoring comps ----------

export type ExcludedReason = "land use" | "future";

export interface ScoredComp {
  comp: PropertyComp;
  distanceKm: number;
  /** ₫/m² after the asking discount and the index roll-forward — what enters the estimate. */
  perM2: number;
  /** 0 when excluded. Relative only: the estimate normalises by the total. */
  weight: number;
  excluded: ExcludedReason | null;
}

type Subject = Pick<Property, "lat" | "lng" | "area_m2" | "land_use" | "access" | "radius_km">;

export function scoreComp(
  subject: Subject,
  comp: PropertyComp,
  today: string,
  index: PropertyIndexPoint[] = [],
): ScoredComp {
  const d = distanceKm(subject, comp);
  const discount = comp.kind === "asking" ? 1 - ASKING_DISCOUNT : 1;
  const perM2 = (comp.price / comp.area_m2) * discount * indexFactor(index, comp.date, today);
  const base = { comp, distanceKm: d, perM2 };

  if (comp.land_use !== subject.land_use) return { ...base, weight: 0, excluded: "land use" };
  if (comp.date > today) return { ...base, weight: 0, excluded: "future" };

  // Nearer counts more, but nothing you added counts for nothing: full weight on top of the
  // plot, half at the search radius, a fifth at twice it. The radius is only a scale here.
  const near = 1 / (1 + (d / subject.radius_km) ** 2);
  const ageYears = (Date.parse(today) - Date.parse(comp.date)) / DAY_MS / YEAR_DAYS;
  const fresh = 0.5 ** (ageYears / HALF_LIFE_YEARS);
  const road = comp.access === subject.access ? 1 : ACCESS_MISMATCH;
  // Per-m² prices fall as plots get bigger; a plot 3× the size keeps under half its say.
  const size = 1 / (1 + Math.abs(Math.log(comp.area_m2 / subject.area_m2)));
  return { ...base, weight: near * fresh * road * size, excluded: null };
}

/** Weighted quantile, interpolating between each value's weight midpoint. */
export function weightedQuantile(values: { v: number; w: number }[], q: number): number {
  const xs = values.filter((x) => x.w > 0).sort((a, b) => a.v - b.v);
  if (xs.length === 0) return NaN;
  if (xs.length === 1) return xs[0].v;
  const total = xs.reduce((s, x) => s + x.w, 0);
  const cum = xs.map((_, i) => xs.slice(0, i + 1).reduce((s, x) => s + x.w, 0));
  const pos = xs.map((x, i) => (cum[i] - x.w / 2) / total);
  if (q <= pos[0]) return xs[0].v;
  if (q >= pos[pos.length - 1]) return xs[xs.length - 1].v;
  const i = pos.findIndex((p) => p >= q);
  const f = (q - pos[i - 1]) / (pos[i] - pos[i - 1]);
  return xs[i - 1].v + f * (xs[i].v - xs[i - 1].v);
}

/** Kish's effective sample size: ten comps where one carries all the weight count as one. */
export function effectiveN(weights: number[]): number {
  const s = weights.reduce((a, w) => a + w, 0);
  const s2 = weights.reduce((a, w) => a + w * w, 0);
  return s2 > 0 ? (s * s) / s2 : 0;
}

// ---------- the estimate ----------

/** What you paid and when — the sum and first date of the holding's transactions. */
export interface Anchor {
  cost: number;
  date: string;
}

export type ValuationMethod =
  /** Comps only — no purchase to anchor to. */
  | "comps"
  /** Comps shrunk toward what you paid. */
  | "blend"
  /** No usable comps: what you paid, carried forward by the area index. */
  | "index"
  /** No usable comps and no index: what you paid, unmoved. */
  | "cost"
  /** Nothing to go on at all. */
  | "none";

export type Confidence = "high" | "medium" | "low";

export interface Valuation {
  method: ValuationMethod;
  low: number;
  mid: number;
  high: number;
  /** `mid` per m² of your plot. */
  perM2: number;
  /** Every comp, scored — the used ones first, by weight. */
  scored: ScoredComp[];
  used: number;
  effectiveN: number;
  confidence: Confidence;
  /** The newest comp that counted, so a stale estimate can say it's stale. */
  newestComp: string | null;
  prior: number | null;
  /** Share of the estimate the comps decided (the rest is the prior). 0 with no comps. */
  compShare: number;
}

export function estimate(
  property: Property,
  comps: PropertyComp[],
  index: PropertyIndexPoint[],
  anchor: Anchor | null,
  today: string,
): Valuation {
  const scored = comps
    .map((c) => scoreComp(property, c, today, index))
    .sort((a, b) => b.weight - a.weight || a.distanceKm - b.distanceKm);
  const usedComps = scored.filter((s) => s.weight > 0);
  const n = effectiveN(usedComps.map((s) => s.weight));
  const prior = anchor && anchor.cost > 0
    ? anchor.cost * indexFactor(index, anchor.date, today)
    : null;
  const newestComp = usedComps.reduce<string | null>(
    (m, s) => (m == null || s.comp.date > m ? s.comp.date : m),
    null,
  );
  const confidence: Confidence = n >= 5 ? "high" : n >= 2 ? "medium" : "low";
  const round = (v: number) => Math.round(v);

  if (usedComps.length === 0) {
    const method: ValuationMethod = prior == null ? "none" : index.length > 0 ? "index" : "cost";
    const v = round(prior ?? 0);
    return {
      method, low: v, mid: v, high: v, perM2: v / property.area_m2,
      scored, used: 0, effectiveN: 0, confidence: "low", newestComp: null, prior, compShare: 0,
    };
  }

  const vals = usedComps.map((s) => ({ v: s.perM2, w: s.weight }));
  const q2 = weightedQuantile(vals, 0.5);
  const spread = MIN_SPREAD / Math.sqrt(Math.max(n, 1));
  const q1 = Math.min(weightedQuantile(vals, 0.25), q2 * (1 - spread));
  const q3 = Math.max(weightedQuantile(vals, 0.75), q2 * (1 + spread));
  const compMid = q2 * property.area_m2;

  // Credibility weighting: the comps' say grows with how much evidence they are. The range
  // is scaled with the middle rather than blended, so it keeps the width the comps showed.
  const compShare = prior == null ? 1 : n / (n + PRIOR_WEIGHT);
  const mid = compShare * compMid + (1 - compShare) * (prior ?? 0);
  const scale = mid / compMid;

  return {
    method: prior == null ? "comps" : "blend",
    low: round(q1 * property.area_m2 * scale),
    mid: round(mid),
    high: round(q3 * property.area_m2 * scale),
    perM2: mid / property.area_m2,
    scored,
    used: usedComps.length,
    effectiveN: n,
    confidence,
    newestComp,
    prior,
    compShare,
  };
}

/** Whether a valuation is a prediction at all. What you paid, unmoved, is not one — nothing
 *  about the market went into it — so a plot with no comps and no index has none. */
export function hasPrediction(v: Pick<Valuation, "method">): boolean {
  return v.method === "comps" || v.method === "blend" || v.method === "index";
}

/** A Real Estate holding with a prediction, beside the value net worth actually counts. */
export interface PredictedHolding {
  name: string;
  booked: number;
  predicted: number;
}

/** How far the predictions move a total: each plot at its estimate instead of its booked
 *  value. Zero when there's nothing predicted, so callers can add it unconditionally. */
export function predictionDelta(items: PredictedHolding[]): number {
  return items.reduce((a, h) => a + h.predicted - h.booked, 0);
}

/** A plot's details page. The name is the holding's, so it's encoded — names have spaces. */
/** The Nhà Tốt listing id in a comp's `source`, or null for a comp that isn't an imported
 *  listing (`listingUrl` in `lib/listings.ts` writes these). */
export function listingId(source: string | null): number | null {
  const m = source?.match(/^https:\/\/www\.nhatot\.com\/(\d+)\.htm$/);
  return m ? Number(m[1]) : null;
}

export function estateHref(name: string): string {
  return `/real-estate/${encodeURIComponent(name)}`;
}

/** One row of the Real estate table: the plot, its booked value, and its valuation without
 *  the scored comps — the list doesn't draw them, so they aren't shipped to it. */
export interface EstateRow {
  name: string;
  booked: number;
  property: Property | null;
  valuation: Omit<Valuation, "scored"> | null;
}
