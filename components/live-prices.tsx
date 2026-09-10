"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { refreshPrices, setPriceRefresh } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { PRICE_REFRESH_INTERVALS, type PriceStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Price controls — and, deliberately, no price fetching on a timer.
 *
 * **The server refreshes prices; a browser only watches.** This file used to own the
 * schedule: an interval in `localStorage`, a pull on open, a `setTimeout` loop, and each
 * tick calling the `refreshPrices` server action, which went out to CoinGecko / Yahoo /
 * fmarket. Three things were wrong with that. The cadence was per-browser, so the laptop
 * and the phone ran two different schedules and neither could see the other's; the pull on
 * open spent a round of upstream calls every time the app was merely *looked at*; and with
 * no tab open, nothing refreshed at all beyond the cron's own fixed five minutes.
 *
 * Now the cadence is one account-wide setting in `meta` (`price_refresh_ms`), the cron in
 * `custom-worker.ts` is the only thing that acts on it, and this file does two much smaller
 * jobs: poll `/api/price-status` to notice that the stamp moved (a `meta` read — it never
 * reaches an upstream feed), and let the reader change the setting or ask for a refresh now.
 *
 * A refresh the reader *asks* for is untouched: the header button and the pull-to-refresh
 * gesture still fetch immediately. What went away is fetching nobody asked for.
 */

// ---------- the shared view of what the server is doing ----------

/** One answer for the whole page: the header pill, the holdings-form button and the poller
 *  are three components that must not disagree about when prices were last pulled. Module
 *  scope rather than context — it outlives a route change, so a client-side nav doesn't
 *  re-ask, and `useSyncExternalStore` keeps every reader in step. */
let status: PriceStatus | null = null;
const statusListeners = new Set<() => void>();

function subscribeStatus(cb: () => void) {
  statusListeners.add(cb);
  return () => {
    statusListeners.delete(cb);
  };
}

function setStatus(next: PriceStatus) {
  status = next;
  for (const cb of statusListeners) cb();
}

/** What the server says about prices: the account's cadence, and when it last ran.
 *  `null` until the first read lands. */
export function usePriceStatus() {
  return React.useSyncExternalStore(
    subscribeStatus,
    () => status,
    () => null, // the server render can't know; the pill shows a neutral state for one beat
  );
}

/** In-flight guard: several effects (a tick, a return to the tab, a route change) can all
 *  decide to re-read at the same moment, and they all want the same answer. */
let statusPending: Promise<void> | null = null;

function fetchStatus(): Promise<void> {
  if (statusPending) return statusPending;
  statusPending = (async () => {
    try {
      const res = await fetch("/api/price-status", { cache: "no-store" });
      if (res.ok) setStatus((await res.json()) as PriceStatus);
    } catch {
      // Offline, or the Worker blinked. Keep the last answer — a stale stamp is a better
      // thing to show than a blank one, and the next tick will correct it.
    } finally {
      statusPending = null;
    }
  })();
  return statusPending;
}

/** The stamp the UI has already reacted to. Module-level because two different components
 *  move it: the poller, when it notices the cron ran, and a manual refresh, which knows it
 *  just caused one. */
let seenAt: number | null = null;

function markSeen() {
  if (status?.atMs != null) seenAt = status.atMs;
}

// ---------- "prices moved" ----------

/** Bumped after every refresh this page has seen — the cron's, or one asked for here.
 *  Anything holding price-derived data that the server can't revalidate on its own — the
 *  client-fetched P&L history behind the chart and calendar — subscribes to know it went
 *  stale. */
const refreshListeners = new Set<() => void>();
let refreshCount = 0;

function subscribeRefresh(cb: () => void) {
  refreshListeners.add(cb);
  return () => {
    refreshListeners.delete(cb);
  };
}

function bumpRefreshCount() {
  refreshCount += 1;
  for (const cb of refreshListeners) cb();
}

/** Counts price refreshes seen. Changes → prices moved → today's P&L moved. */
export function usePriceRefreshCount() {
  return React.useSyncExternalStore(
    subscribeRefresh,
    () => refreshCount,
    () => 0,
  );
}

/**
 * Routes that actually render something a price refresh can move: the dashboard, the
 * holdings themselves, and goals (whose progress is read off the investments total).
 * Savings, debts and transactions display none of it — `/transactions` only redirects.
 *
 * It no longer gates *polling* — a status read is a single `meta` row, and the header
 * clock is on screen everywhere, so it would be odd for it to stop being true on
 * `/savings`. What it gates is `router.refresh()`, which on the dashboard is ~19 D1
 * queries' worth of re-render.
 */
const PRICED_ROUTES = ["/", "/investments", "/goals"];

function showsPrices(pathname: string): boolean {
  return PRICED_ROUTES.some((r) => (r === "/" ? pathname === "/" : pathname.startsWith(r)));
}

// ---------- refreshing on demand ----------

/** Is a refresh in flight? A module-level flag, not component state: both refresh buttons
 *  should spin for the same fetch. */
let busy = false;
const busyListeners = new Set<() => void>();

function subscribeBusy(cb: () => void) {
  busyListeners.add(cb);
  return () => {
    busyListeners.delete(cb);
  };
}

function setBusy(v: boolean) {
  busy = v;
  for (const cb of busyListeners) cb();
}

/**
 * Refresh now, because someone asked — the header button, or the pull-to-refresh gesture.
 * Behind one in-flight guard so the two can't stack requests on each other.
 *
 * This is the only path left that reaches an upstream price feed from a browser, and it is
 * always a deliberate act. It also pulls recent history, so a fund's just-published NAV
 * lands now rather than whenever the 12h backfill next runs.
 */
export function useRefreshPrices() {
  const [, startTransition] = React.useTransition();
  const pending = React.useSyncExternalStore(
    subscribeBusy,
    () => busy,
    () => false,
  );
  const inFlight = React.useRef(false);
  const router = useRouter();

  // No `silent` and no `force` any more — the two flags existed for the auto-tick, which
  // wanted no toast and no server re-render on the dashboard. Every caller left is a person
  // pressing something, and a person gets both: the toast that says what happened, and a
  // full re-render, which also picks up the deposits, debts and goal contributions that the
  // dashboard's `?today=1` channel deliberately doesn't carry.
  const run = React.useCallback(
    async () => {
      if (inFlight.current) return; // never stack requests
      inFlight.current = true;
      setBusy(true);
      try {
        // Awaited OUTSIDE the transition, deliberately. React holds a transition open for
        // as long as its callback is running, and Next's router navigations are themselves
        // transitions — so awaiting a 3-6s price fetch in here made every nav click sit
        // dead until the prices came back. The main thread was idle the whole time; it
        // just looked frozen.
        const res = await refreshPrices();
        // Pick up the stamp we just caused, and claim it: the poller must not treat our own
        // refresh as a second one and render the tree twice.
        await fetchStatus();
        markSeen();
        bumpRefreshCount();
        // Every server-rendered stat (KPIs, allocation, P&L by holding, net worth) is
        // computed from the DB at render time, so re-render the tree to pick up the prices
        // we just wrote. This one *is* a transition: it's a background update, and it must
        // never block what the reader is doing.
        startTransition(() => {
          router.refresh();
        });
        if (res.ok) toast.success(res.message);
        else {
          // The per-source reasons go to the console — the toast has room for the count,
          // not for which feed was down.
          console.error(
            `[price-refresh] ${res.message}` +
              (res.errors.length ? `\n  - ${res.errors.join("\n  - ")}` : ""),
          );
          toast.warning(res.message);
        }
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [startTransition, router],
  );

  return { pending, run };
}

export function RefreshPricesButton() {
  const { pending, run } = useRefreshPrices();
  return (
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run()}>
      <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
      Refresh prices
    </Button>
  );
}

// ---------- watching the server's clock ----------

/** How often to *ask* whether the cron has run — not how often it runs, which is the
 *  server's business. Half a period, so a refresh shows up about halfway through one,
 *  clamped so a 1m cadence isn't asked every few seconds and an hourly one doesn't leave
 *  the header clock an hour wrong. */
function pollDelay(intervalMs: number): number {
  return intervalMs ? Math.min(Math.max(intervalMs / 2, 20_000), 60_000) : 0;
}

/**
 * The watcher, with no UI of its own. Mount this once, high in the tree.
 *
 * Split out from `<LivePrices>` so that where the controls are drawn and how the page
 * learns prices moved stop being the same decision — moving the controls (they have been
 * in the header, then a drawer footer, then the header again) can no longer double or
 * silence the polling.
 *
 * Returns null. It is a behaviour, not a thing on screen.
 */
export function PricePoller() {
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  const st = usePriceStatus();
  const pathname = usePathname();
  const priced = showsPrices(pathname);

  // One read on open. It is a `meta` read, not a price fetch — that distinction is the
  // whole point of this rewrite. Skipped when a client-side nav has already loaded it.
  React.useEffect(() => {
    if (!status) void fetchStatus();
  }, []);

  // Ask again on the poll delay, but never while the tab is hidden — the handler below
  // catches up on return, and a backgrounded PWA polling all night is the sort of thing
  // that is invisible until it shows up on a bill.
  const delay = pollDelay(st?.intervalMs ?? 0);
  React.useEffect(() => {
    if (!delay) return; // the account refreshes nothing on its own; there is no stamp coming
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!document.hidden) void fetchStatus();
      id = setTimeout(tick, delay);
    };
    id = setTimeout(tick, delay);
    return () => clearTimeout(id);
  }, [delay]);

  // A hidden tab skips its polls; catch up the moment it comes back, so the figures you
  // return to are the ones the server already has.
  React.useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) void fetchStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // The stamp moved: the cron re-quoted while this page was open. Everything price-derived
  // on screen is now one refresh behind.
  //
  // `router.refresh()` only where prices are actually drawn, and never on the dashboard,
  // which updates its own price figures from `?today=1` off the count below. The first
  // stamp we ever see is not a move — it is what the page was rendered from.
  const at = st?.atMs ?? null;
  React.useEffect(() => {
    if (at == null || at === seenAt) return;
    const first = seenAt === null;
    seenAt = at;
    if (first) return;
    bumpRefreshCount();
    if (priced && pathname !== "/")
      startTransition(() => {
        router.refresh();
      });
  }, [at, priced, pathname, router, startTransition]);

  return null;
}

// ---------- the controls ----------

const p2 = (n: number) => String(n).padStart(2, "0");

/** The stamp, in the reader's own timezone. Not a live clock: it changes when prices do,
 *  which is the only thing it is there to say. (It used to tick once a second showing the
 *  current time — a clock that was always right and never informative.) */
function stampOf(atMs: number | null): string {
  if (atMs == null) return "—";
  const d = new Date(atMs);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/**
 * The price controls: when prices were last pulled, the cadence the *server* pulls them at,
 * and a refresh-now button.
 *
 * The picker writes an account-wide setting, not a preference for this browser — change it
 * on the phone and the laptop is already following it, because neither of them is doing the
 * refreshing. Pure UI: `<PricePoller>` does the watching.
 *
 * Every variant below keys off the *screen*, because the header is the only place these are
 * drawn and it spans the viewport at every width.
 */
export function LivePrices() {
  const { pending, run } = useRefreshPrices();
  const st = usePriceStatus();
  const intervalMs = st?.intervalMs ?? 0;
  const live = intervalMs > 0;

  const onIntervalChange = (ms: number) => {
    if (!st || ms === st.intervalMs) return;
    // Optimistic: the select is a preference control and must answer the click, not the
    // round trip. A failed write is corrected by the next poll.
    setStatus({ ...st, intervalMs: ms });
    void setPriceRefresh(ms).then((res) => {
      if (res.ms !== ms) setStatus({ ...st, intervalMs: res.ms });
      toast.success(res.message);
    });
  };

  const label = PRICE_REFRESH_INTERVALS.find((i) => i.ms === intervalMs)?.label;

  // A phone can't hold the full row, so both controls drop their words below `sm`:
  // the pill keeps the dot + interval ("● 1m" / "● Off") and Refresh becomes its icon.
  const word = "hidden sm:inline";

  return (
    <div className="flex shrink-0 items-center gap-2 lg:gap-3.5">
      {/* The rail carries the links now, but the clock still waits for xl — the header's
          search field is the thing it shares its row with. */}
      <div className="hidden text-right leading-tight xl:block">
        <div className="text-[11.5px] text-faint">Prices as of</div>
        <div className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
          {stampOf(st?.atMs ?? null)}
        </div>
      </div>

      <Select
        value={String(intervalMs)}
        onValueChange={(v) => v != null && onIntervalChange(Number(v))}
      >
        <SelectTrigger
          size="sm"
          disabled={!st}
          aria-label={
            live ? `Server refreshes prices every ${label}` : "Server price refresh off"
          }
          className={cn(
            "h-7 gap-1.5 rounded-full px-3 text-[12px] font-semibold sm:px-3.5",
            live
              ? "border-transparent bg-accent text-accent-foreground"
              : "border-input bg-pane text-muted-foreground hover:bg-muted",
          )}
        >
          <span className={cn("size-[7px] rounded-full", live ? "animate-pulse-dot bg-accent-brand" : "bg-disabled-foreground")} />
          <span className={word}>Live</span>
          {live ? (
            <span className="tabular-nums">
              <span className={word}>· </span>
              {label}
            </span>
          ) : (
            <span className="sm:hidden">Off</span>
          )}
        </SelectTrigger>
        <SelectContent>
          {PRICE_REFRESH_INTERVALS.map((i) => (
            <SelectItem key={i.ms} value={String(i.ms)}>
              {i.ms === 0 ? "Off" : `Every ${i.label}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <button
        type="button"
        onClick={() => run()}
        disabled={pending}
        aria-label="Refresh prices now"
        title="Refresh prices now"
        className="flex h-7 items-center gap-1.5 rounded-full border border-input bg-transparent px-2 text-[12px] font-semibold text-foreground transition-colors hover:border-brand hover:text-brand disabled:opacity-60 sm:px-3.5"
      >
        <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
        <span className={word}>Refresh</span>
      </button>
    </div>
  );
}
