"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { refreshPrices } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "pf.auto-refresh-ms";

/** Live refresh hits CoinGecko / Yahoo / fmarket on every tick, so the shortest option
 *  is 1m — fast enough for crypto, slow enough to stay under free-tier limits. */
const INTERVALS = [
  { ms: 0, label: "Off" },
  { ms: 60_000, label: "1m" },
  { ms: 300_000, label: "5m" },
  { ms: 900_000, label: "15m" },
] as const;

const VALID_MS = new Set<number>(INTERVALS.map((i) => i.ms));

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

/** Shared refresh logic. `silent` suppresses the success toast so a live refresh every
 *  minute doesn't spam — failures still surface. */
function useRefreshPrices() {
  const [pending, startTransition] = React.useTransition();
  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null);
  const inFlight = React.useRef(false);
  const lastRun = React.useRef(0);
  const router = useRouter();

  const run = React.useCallback(
    (silent = false) => {
      if (inFlight.current) return; // never stack requests
      inFlight.current = true;
      startTransition(async () => {
        try {
          const res = await refreshPrices();
          lastRun.current = Date.now();
          // Every server-rendered stat (KPIs, allocation, P&L by holding, net worth) is
          // computed from the DB at render time, so re-render the tree to pick up the
          // prices we just wrote. The action's revalidatePath alone leaves the client
          // sitting on the tree it already has.
          router.refresh();
          refreshCount += 1;
          for (const cb of refreshListeners) cb();
          if (res.ok) {
            setLastUpdated(new Date());
            if (!silent) toast.success(res.message);
          } else toast.warning(res.message);
        } finally {
          inFlight.current = false;
        }
      });
    },
    [startTransition, router],
  );

  return { pending, run, lastUpdated, lastRun };
}

/** Prices are pulled once when the app opens. Module-level (not a ref) so React's
 *  double-mount in dev — or a client-side nav that remounts the nav — can't re-fire it. */
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
  const { pending, run, lastRun } = useRefreshPrices();
  const intervalMs = React.useSyncExternalStore(subscribeInterval, readInterval, () => 0);
  const live = intervalMs > 0;

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

  // Fresh prices the moment the app opens, without a toast.
  React.useEffect(() => {
    if (refreshedOnOpen) return;
    refreshedOnOpen = true;
    run(true);
  }, [run]);

  // While live is armed, silently re-pull on the chosen interval.
  React.useEffect(() => {
    if (!intervalMs) return;
    const id = setInterval(() => {
      if (document.hidden) return; // don't poll a background tab
      run(true);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, run]);

  // A hidden tab skips its ticks; refresh on return if we're already overdue.
  React.useEffect(() => {
    if (!intervalMs) return;
    const onVisible = () => {
      if (document.hidden) return;
      if (Date.now() - lastRun.current >= intervalMs) run(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [intervalMs, run, lastRun]);

  const onIntervalChange = (ms: number) => {
    writeInterval(ms);
    if (ms) run(true); // refresh straight away so the choice visibly does something
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
        <div className="font-mono text-[10px] tracking-[0.06em] text-faint uppercase">Live prices</div>
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
            "h-7 gap-1.5 rounded-lg px-2.5 font-mono text-[11.5px] sm:px-3",
            live
              ? "border-accent-brand/40 bg-accent text-accent-foreground"
              : "border-input bg-card text-muted-foreground hover:bg-muted",
          )}
        >
          <span className={cn("size-1.5 rounded-full", live ? "animate-pulse bg-accent-brand" : "bg-disabled-foreground")} />
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
        className="flex h-7 items-center gap-1.5 rounded-lg border border-input bg-card px-2 font-mono text-[11.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-60 sm:px-3"
      >
        <RefreshCw className={cn("size-3.5 sm:hidden", pending && "animate-spin")} />
        <span className={cn("hidden size-1.5 rounded-full bg-accent-brand sm:block", pending && "animate-ping")} />
        <span className="hidden sm:inline">Refresh</span>
      </button>
    </div>
  );
}
