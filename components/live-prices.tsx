"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { refreshPrices } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "pf.auto-refresh-ms";

/** When prices were last pulled, in localStorage rather than a ref: a reload — or a second
 *  tab — has to know that live refresh already fetched a moment ago, or every visit pays
 *  for prices it was about to get anyway. */
const LAST_RUN_KEY = "pf.prices-last-run";

function readLastRun() {
  const t = Number(window.localStorage.getItem(LAST_RUN_KEY));
  // A clock change (or a hand-edited value) can leave a timestamp in the future; treat
  // anything that isn't a sane past instant as "never pulled".
  return Number.isFinite(t) && t > 0 && t <= Date.now() ? t : 0;
}

function writeLastRun() {
  try {
    window.localStorage.setItem(LAST_RUN_KEY, String(Date.now()));
  } catch {
    // Private mode / storage disabled: we just lose the cross-reload memory.
  }
}

/** Have prices gone unfetched for longer than the armed interval? */
function overdue(intervalMs: number) {
  return Date.now() - readLastRun() >= intervalMs;
}

/** Live refresh hits CoinGecko / Yahoo / fmarket on every tick. 5s is the fastest — handy
 *  for watching crypto move in near-real-time, but it leans on the free-tier limits, so the
 *  slower steps stay the sensible default for leaving a tab open all day. */
const INTERVALS = [
  { ms: 0, label: "Off" },
  { ms: 5_000, label: "5s" },
  { ms: 30_000, label: "30s" },
  { ms: 60_000, label: "1m" },
  { ms: 300_000, label: "5m" },
  { ms: 900_000, label: "15m" },
] as const;

const VALID_MS = new Set<number>(INTERVALS.map((i) => i.ms));

/** Routes that actually render something a price refresh can move: the dashboard, the
 *  holdings themselves, and goals (whose progress is read off the investments total).
 *  Savings, debts and transactions display none of it — `/transactions` only redirects.
 *
 *  This component lives in the nav, so it is mounted everywhere. Without this gate a tick
 *  on `/savings` still fetched every upstream feed and re-rendered a page with no price on
 *  it, which on the dashboard is ~19 D1 queries' worth of work for nothing. */
const PRICED_ROUTES = ["/", "/investments", "/goals"];

function showsPrices(pathname: string): boolean {
  return PRICED_ROUTES.some((r) => (r === "/" ? pathname === "/" : pathname.startsWith(r)));
}

/** A tiny localStorage-backed store, so the live setting survives a reload and every
 *  mount agrees on it. `useSyncExternalStore` is what keeps the SSR snapshot (0 / off)
 *  from desyncing against the client's saved value — and it lets two open tabs stay in
 *  step via the `storage` event. */
const listeners = new Set<() => void>();

function subscribeInterval(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function readInterval() {
  const ms = Number(window.localStorage.getItem(STORAGE_KEY));
  return VALID_MS.has(ms) ? ms : 0;
}

function writeInterval(ms: number) {
  window.localStorage.setItem(STORAGE_KEY, String(ms));
  for (const cb of listeners) cb();
}

/** Bumped after every successful refresh. Anything holding price-derived data that the
 *  server can't revalidate on its own — the client-fetched P&L history behind the chart
 *  and calendar — subscribes to this to know it went stale. */
const refreshListeners = new Set<() => void>();
let refreshCount = 0;

function subscribeRefresh(cb: () => void) {
  refreshListeners.add(cb);
  return () => {
    refreshListeners.delete(cb);
  };
}

/** Counts completed price refreshes. Changes → prices moved → today's P&L moved. */
export function usePriceRefreshCount() {
  return React.useSyncExternalStore(
    subscribeRefresh,
    () => refreshCount,
    () => 0,
  );
}

/** Is a refresh in flight? A module-level flag, not component state: both refresh
 *  buttons should spin for the same fetch, and `run` is called straight out of an effect
 *  on open — where a setState would trip the React Compiler's `set-state-in-effect` rule. */
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
 * Shared refresh logic, behind one in-flight guard so the header button, the live tick and
 * a pull-to-refresh can't stack requests on each other.
 *
 * `silent` suppresses the success toast so a refresh every few seconds doesn't spam —
 * failures still surface. `force` re-renders the server tree even on the dashboard, which
 * normally opts out because it updates its own price figures from `?today=1`; a refresh the
 * reader *asked* for should also pick up deposits, debts and goal contributions, which that
 * channel doesn't carry.
 */
export function useRefreshPrices() {
  const [, startTransition] = React.useTransition();
  // The dashboard re-reads its own price-derived figures from `?today=1` (see
  // `DashboardCharts`), so re-rendering the server tree for it is pure waste — that render
  // costs ~19 D1 queries, of which only the portfolio ones can have moved. Every other
  // route still needs the refresh: /investments and /goals render prices server-side and
  // have no such channel. Kept as a route list rather than a flag so the two places that
  // decide "does this page show prices" stay next to each other.
  const selfUpdating = usePathname() === "/";
  const pending = React.useSyncExternalStore(
    subscribeBusy,
    () => busy,
    () => false,
  );
  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null);
  const inFlight = React.useRef(false);
  const router = useRouter();

  const run = React.useCallback(
    async ({ silent = false, force = false }: { silent?: boolean; force?: boolean } = {}) => {
      if (inFlight.current) return; // never stack requests
      inFlight.current = true;
      setBusy(true);
      try {
        // Awaited OUTSIDE the transition, deliberately. React holds a transition open for
        // as long as its callback is running, and Next's router navigations are themselves
        // transitions — so awaiting a 3-6s price fetch in here made every nav click sit
        // dead until the prices came back. The main thread was idle the whole time; it
        // just looked frozen.
        //
        // A hand-triggered refresh also pulls recent history, so a fund's just-published
        // NAV lands now rather than whenever the 12h backfill next runs; the silent
        // every-tick refresh stays live-prices-only.
        const res = await refreshPrices(!silent);
        writeLastRun();
        // Every server-rendered stat (KPIs, allocation, P&L by holding, net worth) is
        // computed from the DB at render time, so re-render the tree to pick up the
        // prices we just wrote. The action's revalidatePath alone leaves the client
        // sitting on the tree it already has. This one *is* a transition: it's a
        // background update, and it must never block what the reader is doing.
        if (force || !selfUpdating)
          startTransition(() => {
            router.refresh();
          });
        refreshCount += 1;
        for (const cb of refreshListeners) cb();
        if (res.ok) {
          setLastUpdated(new Date());
          if (!silent) toast.success(res.message);
        } else {
          // Failures always go to the console as an error log — including silent
          // auto-refreshes, which show no toast panel. A manual refresh also gets a toast.
          console.error(
            `[price-refresh] ${res.message}` +
              (res.errors.length ? `\n  - ${res.errors.join("\n  - ")}` : ""),
          );
          if (!silent) toast.warning(res.message);
        }
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [startTransition, router, selfUpdating],
  );

  return { pending, run, lastUpdated };
}

/** The open-time pull is considered once per page load. Module-level (not a ref) so
 *  React's double-mount in dev — or a client-side nav that remounts the nav — can't
 *  re-fire it. */
let refreshedOnOpen = false;

export function RefreshPricesButton() {
  const { pending, run } = useRefreshPrices();
  return (
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run()}>
      <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
      Refresh prices
    </Button>
  );
}

/** The nav's price controls: a clock, a Live pill that doubles as the interval picker,
 *  and a manual refresh. This is the single place prices are polled from — mounted once
 *  in the nav, it covers every page. */
export function LivePrices() {
  const { pending, run } = useRefreshPrices();
  const intervalMs = React.useSyncExternalStore(subscribeInterval, readInterval, () => 0);
  const live = intervalMs > 0;

  // Whether the page under the nav shows anything a refresh can move. The ref is what the
  // free-running tick timer reads (see below); the value itself drives the catch-up.
  const pathname = usePathname();
  const priced = showsPrices(pathname);
  const pricedRef = React.useRef(priced);
  // Synced in an effect, not during render: `react-hooks/refs` forbids the latter, and a
  // timer reading it after commit is exactly the case the rule permits.
  React.useEffect(() => {
    pricedRef.current = priced;
  }, [priced]);

  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0); // async so we don't setState synchronously in the effect
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  // Fresh prices when the app opens — but with live refresh armed they're already being
  // kept current, so a reload, a second tab, or dipping back into the PWA shouldn't spend
  // an API call on prices pulled seconds ago. Only the interval's own overdue rule decides.
  //
  // Deliberately not consumed while off a priced route: opening straight onto /savings
  // should not spend a pull, but walking from there to the dashboard still should — so the
  // flag is set the first time prices are actually on screen, not the first time we mount.
  React.useEffect(() => {
    if (refreshedOnOpen || !priced) return;
    refreshedOnOpen = true;
    // Read the armed interval from storage rather than taking `intervalMs` from the
    // render: this effect fires after the *hydration* pass, where useSyncExternalStore
    // still reports the server snapshot (0 / off) — which would read as "not armed" and
    // pull on every single visit, exactly what this check exists to prevent.
    const armed = readInterval();
    if (armed && !overdue(armed)) return;
    void run({ silent: true });
  }, [priced, run]);

  // While live is armed, silently re-pull on the chosen interval. The first delay is
  // whatever is *left* of the current period rather than a full one — otherwise skipping
  // the pull above would stretch the gap across a reload to nearly two intervals.
  React.useEffect(() => {
    if (!intervalMs) return;
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      // Don't poll a background tab, or a page showing no prices; the handlers below catch
      // up on return. `priced` is read through a ref rather than closed over so a route
      // change doesn't restart the timer — navigating often would otherwise keep pushing
      // the next tick out and starve the refresh entirely.
      if (!document.hidden && pricedRef.current) void run({ silent: true });
      id = setTimeout(tick, intervalMs);
    };
    id = setTimeout(tick, Math.max(0, intervalMs - (Date.now() - readLastRun())));
    return () => clearTimeout(id);
  }, [intervalMs, run]);

  // A hidden tab skips its ticks; refresh on return if we're already overdue.
  React.useEffect(() => {
    if (!intervalMs) return;
    const onVisible = () => {
      if (document.hidden) return;
      if (overdue(intervalMs)) void run({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [intervalMs, run]);

  // The same catch-up for the other reason ticks get skipped: landing back on a page that
  // shows prices after time spent on one that doesn't. Without it you'd wait out up to a
  // full interval looking at figures the gate above deliberately let go stale.
  React.useEffect(() => {
    if (!intervalMs || !priced) return;
    if (overdue(intervalMs)) void run({ silent: true });
  }, [intervalMs, priced, run]);

  const onIntervalChange = (ms: number) => {
    writeInterval(ms);
    if (ms) void run({ silent: true }); // refresh straight away so the choice visibly does something
  };

  const p2 = (n: number) => String(n).padStart(2, "0");
  const stamp = now
    ? `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`
    : "—";

  const label = INTERVALS.find((i) => i.ms === intervalMs)?.label;

  // A phone can't hold the full row, so both controls drop their words below `sm`:
  // the pill keeps the dot + interval ("● 1m" / "● Off") and Refresh becomes its icon.
  return (
    <div className="flex shrink-0 items-center gap-2 lg:gap-3.5">
      {/* The nav pills gained icons and now need the width the clock used to take at lg,
          so it waits for xl. */}
      <div className="hidden text-right leading-tight xl:block">
        <div className="text-[11.5px] text-faint">Live prices</div>
        <div className="font-mono text-[11.5px] tabular-nums text-muted-foreground">{stamp}</div>
      </div>

      <Select
        value={String(intervalMs)}
        onValueChange={(v) => v != null && onIntervalChange(Number(v))}
      >
        <SelectTrigger
          size="sm"
          aria-label={live ? `Live refresh every ${label}` : "Live refresh off"}
          className={cn(
            "h-7 gap-1.5 rounded-full px-3 text-[12px] font-semibold sm:px-3.5",
            live
              ? "border-transparent bg-accent text-accent-foreground"
              : "border-input bg-pane text-muted-foreground hover:bg-muted",
          )}
        >
          <span className={cn("size-[7px] rounded-full", live ? "animate-pulse-dot bg-accent-brand" : "bg-disabled-foreground")} />
          <span className="hidden sm:inline">Live</span>
          {live ? (
            <span className="tabular-nums">
              <span className="hidden sm:inline">· </span>
              {label}
            </span>
          ) : (
            <span className="sm:hidden">Off</span>
          )}
        </SelectTrigger>
        <SelectContent>
          {INTERVALS.map((i) => (
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
        aria-label="Refresh prices"
        title="Refresh prices"
        className="flex h-7 items-center gap-1.5 rounded-full border border-input bg-transparent px-2 text-[12px] font-semibold text-foreground transition-colors hover:border-brand hover:text-brand disabled:opacity-60 sm:px-3.5"
      >
        <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
        <span className="hidden sm:inline">Refresh</span>
      </button>
    </div>
  );
}
