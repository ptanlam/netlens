/**
 * Server-side price scheduler — the "cron" for prices.
 *
 * The in-browser "Live" polling (components/live-prices.tsx) only ticks while a tab is open
 * and visible, so with the app closed nothing ever refreshes. This runs in the Node server
 * process itself (Next calls `register()` once on boot), so it keeps live prices AND the
 * daily NAV/close history fresh regardless of whether anyone has the app open.
 *
 * Interval via `PRICE_REFRESH_MS`. Defaults to 5 min in production and OFF in development
 * (so `npm run dev` doesn't hammer the upstream APIs); set `PRICE_REFRESH_MS=0` to disable,
 * or any positive ms to override. Runs once per instance — the SQLite volume is attached to
 * a single Railway instance, so there's exactly one writer.
 */
export async function register() {
  // Only the Node runtime has better-sqlite3 / DB access; skip edge & the browser.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const def = process.env.NODE_ENV === "production" ? 300_000 : 0;
  const ms = process.env.PRICE_REFRESH_MS != null ? Number(process.env.PRICE_REFRESH_MS) : def;
  if (!Number.isFinite(ms) || ms <= 0) return;

  // Dev HMR can call register() again in the same process — never stack a second loop.
  const g = globalThis as unknown as { __priceCron?: boolean };
  if (g.__priceCron) return;
  g.__priceCron = true;

  const { refreshAll, refreshHistory } = await import("@/lib/prices");

  let running = false;
  const tick = async () => {
    if (running) return; // a slow fetch must never overlap the next tick
    running = true;
    try {
      const [updated, errors] = await refreshAll();
      // Self-throttles to every 12h internally, so calling it each tick is cheap — it's how
      // new daily closes / NAV dates land without someone opening the dashboard.
      await refreshHistory();
      if (errors.length)
        console.error(
          `[price-cron] updated ${updated}, ${errors.length} failed:\n  - ${errors.join("\n  - ")}`,
        );
      else console.log(`[price-cron] updated ${updated} price(s)`);
    } catch (e) {
      console.error("[price-cron] refresh failed:", e);
    } finally {
      running = false;
    }
  };

  void tick(); // prime immediately on boot so a fresh deploy isn't stale
  setInterval(tick, ms);
  console.log(`[price-cron] scheduled every ${Math.round(ms / 1000)}s`);
}
