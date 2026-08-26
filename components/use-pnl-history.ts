"use client";

import * as React from "react";
import type { HoldingPnlPoint, LivePayload, PnlPoint } from "@/lib/types";
import { usePriceRefreshCount } from "@/components/live-prices";

/** What `/api/pnl-history` returns. */
type PnlHistory = { series: PnlPoint[]; holdings: HoldingPnlPoint[]; live?: LivePayload };

/**
 * The series, kept across remounts of this hook.
 *
 * `/api/pnl-history` is the most expensive read in the app — it reconstructs every day
 * since your first transaction — and navigating away and back used to pay for it again in
 * full. `router.refresh()` doesn't remount, so this is exactly the navigation case.
 *
 * Keyed on `historyStamp`, which the server bumps whenever a settled day moves (a
 * backfill, the recent-days sweep, any transaction edit) and which carries the current
 * date, so a tab left open overnight rebuilds. Today's own point is *not* part of the key:
 * it moves on every price tick, and a cache hit tops it up through `?today=1` — the cheap
 * query — rather than refetching hundreds of settled days to learn one new number.
 *
 * Module-level, so it lives as long as the tab and dies with a hard reload. Nothing here
 * is user-specific: this is a single-tenant app, and it is the same data the pages it
 * serves were rendered from. It is shared by every page that draws the series — the
 * dashboard and Investments — which is the point: moving between them is now free.
 */
let historyCache: { stamp: string; series: PnlPoint[]; holdings: HoldingPnlPoint[] } | null = null;

/** A price refresh can only move *today* — every earlier day is settled history. So the
 *  latest point is spliced onto the series we already have rather than refetched. */
function withLatest<T extends { date: string }>(prev: T[], tail: T[]): T[] {
  if (!tail.length) return prev;
  const latest = tail[tail.length - 1];
  if (!prev.length) return [latest];
  const last = prev[prev.length - 1];
  if (last.date === latest.date) return [...prev.slice(0, -1), latest];
  if (latest.date > last.date) return [...prev, latest]; // tab left open past midnight
  return prev;
}

export interface PnlHistoryView {
  series: PnlPoint[] | null;
  holdings: HoldingPnlPoint[] | null;
  /** The price-derived figures as of the last tick, or null before one has landed — the
   *  caller falls back to its server-rendered payload. This is what lets a tick skip
   *  `router.refresh()` on a page built from it. */
  live: LivePayload | null;
  /** When what's on screen landed, as an instant. The portfolio chart draws its final point
   *  here rather than at that date's midnight, so a tick visibly carries the curve forward
   *  — including the ticks where the price came back unchanged. */
  asOf: number | null;
  error: string | null;
}

/**
 * The daily P&L history, fetched once per stamp and topped up on every price tick.
 *
 * Extracted from the dashboard so Investments can draw the same holding sparks without a
 * second implementation of the cache — and so the two pages share one, rather than each
 * rebuilding the series the other just fetched.
 */
export function usePnlHistory(historyStamp: string): PnlHistoryView {
  // `Response.json()` resolves to `unknown` under the Workers type definitions (the DOM lib
  // types it as `any`), so the shape is asserted here rather than in each callback.
  const [series, setSeries] = React.useState<PnlPoint[] | null>(null);
  const [holdings, setHoldings] = React.useState<HoldingPnlPoint[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [live, setLive] = React.useState<LivePayload | null>(null);
  // Stamped in the callbacks, not during render: reading a clock while rendering is impure
  // (`react-hooks/purity`), and this is the moment that actually means something anyway —
  // when the data arrived.
  const [asOf, setAsOf] = React.useState<number | null>(null);
  const refreshCount = usePriceRefreshCount();
  const loaded = series !== null;

  // Today's point, spliced onto whatever series is already on screen. Both the tick and a
  // cache hit want exactly this, and neither wants the days behind it refetched.
  const spliceLatest = React.useCallback((d: PnlHistory) => {
    setSeries((s) => (s ? withLatest(s, d.series) : s));
    setHoldings((h) => (h ? withLatest(h, d.holdings) : h));
    setAsOf(Date.now());
    if (d.live) setLive(d.live);
  }, []);

  React.useEffect(() => {
    let alive = true;
    // Read before the effect below can write, which is why that one is declared after this.
    const hit = historyCache?.stamp === historyStamp ? historyCache : null;
    // A hit still asks for today: the cached copy carries whatever price it was fetched at,
    // and only this day can have moved since. The cached days are then applied *with* that
    // answer rather than ahead of it — one render, and never a frame showing a stale price.
    // (The server renders with no cache, so this cannot run before hydration either way.)
    fetch(hit ? "/api/pnl-history?today=1" : "/api/pnl-history")
      .then((r) => (r.ok ? (r.json() as Promise<PnlHistory>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (!alive) return;
        setSeries(hit ? withLatest(hit.series, d.series) : d.series);
        setHoldings(hit ? withLatest(hit.holdings, d.holdings) : d.holdings);
        setAsOf(Date.now());
        if (d.live) setLive(d.live);
        setError(null); // a good re-pull clears a stale error from an earlier attempt
      })
      .catch((e: Error) => {
        if (!alive) return;
        // Only today's top-up failed — the settled days in hand are still every bit as good.
        if (hit) { setSeries(hit.series); setHoldings(hit.holdings); setError(null); }
        else setError(e.message);
      });
    return () => { alive = false; };
  }, [historyStamp]);

  // Keep the cache level with what's on screen, so coming back restores the series
  // *including* the ticks spliced onto it since — not the state it was fetched in. Declared
  // after the effect above so a stamp change is a miss there, not a hit.
  React.useEffect(() => {
    if (series && holdings) historyCache = { stamp: historyStamp, series, holdings };
  }, [series, holdings, historyStamp]);

  // Prices moved, so today's P&L moved with them — re-pull just that day and splice it in.
  // Waits on `loaded` so the refresh fired on app open still lands (it usually completes
  // while the first, full history fetch is still in flight).
  React.useEffect(() => {
    if (!refreshCount || !loaded) return;
    let alive = true;
    fetch("/api/pnl-history?today=1")
      .then((r) => (r.ok ? (r.json() as Promise<PnlHistory>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => alive && spliceLatest(d))
      .catch(() => {}); // a failed top-up just leaves the last good figures on screen
    return () => { alive = false; };
  }, [refreshCount, loaded, spliceLatest]);

  return { series, holdings, live, asOf, error };
}
