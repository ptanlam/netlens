"use client";

import * as React from "react";
import { fmtVND } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Editorial net-worth hero: a large mono figure with a breakdown rail. */
export function NetWorthPanel({
  investments,
  savings,
  funds,
  debts,
  todayDelta,
}: {
  investments: number;
  savings: number;
  /** Money set aside in sinking funds. Still yours until you spend it, so it counts. */
  funds: number;
  debts: number;
  /** Day-over-day P&L move; null while the series is still loading. */
  todayDelta?: number | null;
}) {
  const net = investments + savings + funds - debts;

  // Flash the figure — green up, red down — whenever it moves. A price refresh re-renders
  // this panel with a new total; we compare against the last one we showed and, on a real
  // change, restart the tick animation (bumping `n` remounts the node so it replays even on
  // back-to-back refreshes). First mount seeds `prev` with the current value, so nothing
  // flashes on load. `onAnimationEnd` clears the state; reduced-motion users just see the
  // number update, since the animation utilities are gated behind that media query.
  const prev = React.useRef(net);
  const seq = React.useRef(0);
  const [flash, setFlash] = React.useState<{ dir: "up" | "down"; n: number } | null>(null);
  React.useEffect(() => {
    if (net === prev.current) return;
    const dir = net > prev.current ? "up" : "down";
    prev.current = net;
    seq.current += 1;
    setFlash({ dir, n: seq.current });
  }, [net]);

  // The set-aside line only earns its place once there's something in it — an empty rail
  // row on every dashboard would be noise for anyone not saving up for anything. Rounded,
  // so a fund that's been spent down to sub-₫1 dust doesn't leave a "₫0" line behind.
  const hasFunds = Math.round(funds) !== 0;
  const parts = [
    { label: "Investments", value: investments, sign: "", cls: "text-foreground" },
    { label: "Savings", value: savings, sign: "+", cls: "text-accent-brand" },
    ...(hasFunds
      ? [{ label: "Set aside", value: funds, sign: "+", cls: "text-accent-brand" }]
      : []),
    { label: "Debts", value: debts, sign: "−", cls: "text-(--chart-negative)" },
  ];

  return (
    <div className="flex flex-wrap items-end justify-between gap-10">
      <div>
        <div className="font-mono text-[11px] tracking-[0.14em] text-faint uppercase">
          Net worth
        </div>
        <div className="mt-2.5 flex items-center gap-3">
          <div
            key={flash?.n ?? "static"}
            onAnimationEnd={() => setFlash(null)}
            className={cn(
              "font-mono text-[44px] leading-[0.95] font-medium tracking-[-0.03em] text-foreground tabular-nums will-change-transform sm:text-[56px]",
              flash?.dir === "up" && "animate-nw-flash-up",
              flash?.dir === "down" && "animate-nw-flash-down",
            )}
          >
            {fmtVND(net)}
          </div>
          {/* Direction arrow, shown only while a refresh's flash is playing — same green/red
              cue as the figure, so the move reads at a glance. Sibling (not child) of the
              number so its own animation-end never clears the flash early. */}
          {flash && (
            <span
              aria-hidden
              className={cn(
                "animate-fade-in font-mono text-[26px] leading-none sm:text-[32px]",
                flash.dir === "up" ? "text-accent-brand" : "text-(--chart-negative)",
              )}
            >
              {flash.dir === "up" ? "▲" : "▼"}
            </span>
          )}
        </div>
        <div className="mt-3.5 flex flex-wrap items-center gap-3.5">
          <span className="text-[13px] text-muted-foreground">
            {hasFunds
              ? "Investments + Savings + Set aside − Debts"
              : "Investments + Savings − Debts"}
          </span>
          {todayDelta != null && todayDelta !== 0 && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-[3px] font-mono text-[12px] tabular-nums",
                todayDelta < 0
                  ? "bg-negative-wash-strong text-(--chart-negative)"
                  : "bg-accent text-accent-brand",
              )}
            >
              {todayDelta < 0 ? "▾" : "▴"} Today {todayDelta < 0 ? "−" : "+"}
              {fmtVND(Math.abs(todayDelta)).replace("-", "")}
            </span>
          )}
        </div>
      </div>

      <div className="min-w-[290px] border-l border-border pl-6.5">
        {parts.map((p, i) => (
          <div
            key={p.label}
            className={cn(
              "flex items-baseline justify-between py-[7px]",
              i < parts.length - 1 && "border-b border-divider",
            )}
          >
            <span className="text-[13px] text-muted-foreground">{p.label}</span>
            <span className={cn("font-mono text-[15px] tabular-nums", p.cls)}>
              {p.sign}
              {fmtVND(p.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
