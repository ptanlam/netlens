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
 */
// Generated at build time by the adapter; typed in types/open-next.d.ts.
import { default as handler } from "./.open-next/worker.js";
import { bindD1 } from "./lib/db";
import { refreshAll, refreshHistory, sweepRecentHistory } from "./lib/prices";

const COOKIE_NAME = "inv_auth";

/** Same derivation as `lib/auth.ts` (which uses node:crypto), so the cookie the `login`
 *  action sets is the one this checks. Cached because it never changes for a given
 *  password and this runs on every request. */
let cachedToken: string | null = null;
async function expectedToken(password: string): Promise<string> {
  if (cachedToken) return cachedToken;
  const data = new TextEncoder().encode(`investment-viz::${password}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  cachedToken = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return cachedToken;
}

/**
 * The password gate, formerly `proxy.ts`.
 *
 * It had to move: Next.js 16 runs Proxy on the Node.js runtime and *refuses* a `runtime`
 * override ("Setting the runtime config option in Proxy will throw an error"), while the
 * Cloudflare adapter rejects Node.js middleware outright — so no proxy.ts can build at all.
 *
 * Doing it here is arguably where it belonged: the Next docs describe Proxy as "a network
 * boundary in front of the app", and the Worker genuinely is one. It also now covers route
 * handlers (/api/*, /export.csv, /healthz) that the old `matcher` pattern let through.
 */
async function gate(request: Request, password: string): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname === "/login") return null;
  // Next's own build output, icons and the PWA manifest — never sensitive, and blocking
  // them breaks the login page. The manifest especially: redirecting it to /login hands the
  // browser HTML where it expects JSON, which it reports as a manifest syntax error.
  if (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/icon.svg" ||
    pathname.endsWith(".png")
  )
    return null;

  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);

  if (cookie && cookie === (await expectedToken(password))) return null;
  return Response.redirect(new URL("/login", request.url).toString(), 302);
}

export default {
  async fetch(request, env, ctx) {
    // No password set -> open (dev), exactly as before.
    const password = env.APP_PASSWORD;
    if (password) {
      const blocked = await gate(request, password);
      if (blocked) return blocked;
    }
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
          const [updated, errors] = await refreshAll();
          // Deep backfill (12h) plus a narrow sweep (30m) of the last few days, so a
          // close that settles mid-gate lands within the half hour instead of waiting
          // out the backfill. Both self-throttle, so calling them each tick is cheap.
          await refreshHistory();
          errors.push(...(await sweepRecentHistory())[1]);
          if (errors.length)
            console.error(
              `[price-cron] updated ${updated}, ${errors.length} failed:\n  - ${errors.join("\n  - ")}`,
            );
          else console.log(`[price-cron] updated ${updated} price(s)`);
        } catch (e) {
          console.error("[price-cron] refresh failed:", e);
        }
      })(),
    );
  },
} satisfies ExportedHandler<CloudflareEnv>;
