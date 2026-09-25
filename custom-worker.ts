/**
 * Worker entrypoint: the Next.js app, plus the price scheduler.
 *
 * Replaces `instrumentation.ts`, which kept prices fresh with a `setInterval` inside the
 * long-lived Node server. A Worker has no such process — it exists only for the length of a
 * request — so the timer becomes a Cron Trigger (schedule in wrangler.jsonc).
 *
 * Two behaviours from the old loop are now free rather than hand-rolled:
 *  - **No overlap.** The old code kept a `running` flag so a slow fetch couldn't have the
 *    next tick land on top of it. Cloudflare will not start a scheduled invocation while
 *    the previous one is still running.
 *  - **One writer.** The old comment noted the SQLite volume was attached to a single
 *    Railway instance, so there was exactly one writer by construction. D1 serialises
 *    writes itself, so concurrent Server Actions and this cron can't corrupt each other.
 *
 * `refreshHistory` (deep, 12h) and `sweepRecentHistory` (the last few days, 30m) both
 * self-throttle internally, so calling them each tick is cheap — together they are how new
 * daily closes / NAV dates land without someone opening the app.
 *
 * Live prices work the same way now. The tick is every minute, but `refreshScheduled`
 * fetches only when the account's stored cadence says it is due (`meta.price_refresh_ms`,
 * set from the header pill) — so one cron expression serves every cadence on the menu, and
 * a browser opening the app no longer spends a round of upstream calls to see fresh
 * figures. **This is the only thing that fetches prices on a schedule.**
 */
// Generated at build time by the adapter; typed in types/open-next.d.ts.
import { default as handler } from "./.open-next/worker.js";
import { bindD1 } from "./lib/db";
import { refreshAutoCompsScheduled } from "./lib/listings";
import { refreshHistory, refreshScheduled, sweepRecentHistory } from "./lib/prices";

export default {
  /**
   * Straight to the app: **authentication is Cloudflare Access**, not this Worker.
   *
   * A shared-password gate used to run here first (before that, `proxy.ts`), and it is gone
   * on purpose. Access sits in front of `netlens.lamphan.com` and never forwards an
   * unauthenticated request, so the gate was a second prompt guarding a door already shut —
   * and a static secret with no expiry, no rotation and no record of who used it, which is
   * strictly less than what Access gives.
   *
   * That leans on two lines in wrangler.jsonc rather than on anything here: `workers_dev`
   * and `preview_urls` are both `false`, so the zone route Access protects is the only way
   * in. Turning either on re-opens an unauthenticated path to this Worker and the same D1
   * data — there is now no second lock behind it.
   */
  async fetch(request, env, ctx) {
    return handler.fetch(request, env, ctx);
  },

  async scheduled(_event, env, ctx) {
    // A cron tick never goes through the adapter's fetch handler, so the Cloudflare
    // context `lib/db` normally reads is not there — without this the very first query
    // throws and the whole schedule is silently dead. See `bindD1`.
    bindD1(env.DB);
    // `waitUntil` so the invocation isn't torn down while the upstream feeds are still
    // being polled — several of them are slow, and one is a scraped HTML page.
    ctx.waitUntil(
      (async () => {
        try {
          // `null` = this minute wasn't due under the account's cadence, and says so by
          // logging nothing: most ticks are skips now that the trigger runs every minute.
          const live = await refreshScheduled();
          const errors = live ? live[1] : [];
          // Deep backfill (12h) plus a narrow sweep (30m) of the last few days, so a
          // close that settles mid-gate lands within the half hour instead of waiting
          // out the backfill. Both self-throttle, so calling them each tick is cheap.
          await refreshHistory();
          errors.push(...(await sweepRecentHistory())[1]);
          // Once a day: each plot with auto-comps on gets its nearest listings refreshed.
          errors.push(...(await refreshAutoCompsScheduled()));
          if (errors.length)
            console.error(
              `[price-cron] updated ${live?.[0] ?? 0}, ${errors.length} failed:\n  - ${errors.join("\n  - ")}`,
            );
          else if (live) console.log(`[price-cron] updated ${live[0]} price(s)`);
        } catch (e) {
          console.error("[price-cron] refresh failed:", e);
        }
      })(),
    );
  },
} satisfies ExportedHandler<CloudflareEnv>;
