"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { refreshPrices } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "pf.auto-refresh-ms";

/** Auto-refresh hits CoinGecko / Yahoo / fmarket on every tick, so the shortest
 *  option is 1m — fast enough for crypto, slow enough to stay under free-tier limits. */
const INTERVALS = [
  { value: "0", label: "Auto: off" },
  { value: "60000", label: "Auto: 1m" },
  { value: "300000", label: "Auto: 5m" },
  { value: "900000", label: "Auto: 15m" },
] as const;

const VALID_MS = new Set(INTERVALS.map((i) => Number(i.value)));

/** A tiny localStorage-backed store. `useSyncExternalStore` is what keeps the SSR
 *  snapshot (0 / off) from desyncing against the client's saved value — and it lets
 *  two open tabs stay in step via the `storage` event. */
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

/** Shared refresh logic. `silent` suppresses the success toast so an auto-refresh
 *  every minute doesn't spam — failures still surface. */
function useRefreshPrices() {
  const [pending, startTransition] = React.useTransition();
  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null);
  const inFlight = React.useRef(false);
  const lastRun = React.useRef(0);

  const run = React.useCallback(
    (silent = false) => {
      if (inFlight.current) return; // never stack requests
      inFlight.current = true;
      startTransition(async () => {
        try {
          const res = await refreshPrices();
          lastRun.current = Date.now();
          if (res.ok) {
            setLastUpdated(new Date());
            if (!silent) toast.success(res.message);
          } else toast.warning(res.message);
        } finally {
          inFlight.current = false;
        }
      });
    },
    [startTransition],
  );

  return { pending, run, lastUpdated, lastRun };
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

/** Manual refresh + an auto-refresh interval picker. The choice persists per-browser
 *  in localStorage (shared by every mount, so the dashboard and Investments agree).
 *  Polling pauses while the tab is hidden and catches up on return.
 *
 *  `showTimestamp` is off where the surrounding UI already renders a "prices as of"
 *  line (the dashboard's Live prices card), to avoid two competing timestamps. */
export function RefreshPricesControls({ showTimestamp = true }: { showTimestamp?: boolean } = {}) {
  const { pending, run, lastUpdated, lastRun } = useRefreshPrices();
  const intervalMs = React.useSyncExternalStore(subscribeInterval, readInterval, () => 0);

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

  const onIntervalChange = (v: string) => {
    const ms = Number(v);
    writeInterval(ms);
    if (ms) run(true); // refresh straight away so the choice visibly does something
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run()}>
        <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
        Refresh prices
      </Button>
      <Select
        value={String(intervalMs)}
        onValueChange={(v) => v != null && onIntervalChange(v as string)}
      >
        <SelectTrigger size="sm" aria-label="Auto-refresh interval" className="w-[8.5rem]">
          {/* Values are millisecond numbers, so map back to the label — a bare
              <SelectValue/> would render "60000". */}
          <SelectValue>
            {(v) => INTERVALS.find((i) => i.value === String(v))?.label ?? "Auto: off"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {INTERVALS.map((i) => (
            <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showTimestamp && lastUpdated && (
        <span className="text-xs tabular-nums text-muted-foreground">
          Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
    </div>
  );
}
