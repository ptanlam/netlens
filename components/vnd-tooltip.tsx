"use client";

import { fmtVND } from "@/lib/format";

/** Tooltip row: color key + name, VND value leading (formatter for ChartTooltipContent). */
export function vndRow(
  value: unknown,
  name: unknown,
  item: { color?: string; payload?: { fill?: string } },
  labels?: Record<string, string>,
) {
  const key = String(name);
  return (
    <>
      <div
        className="h-2.5 w-1 shrink-0 rounded-[2px]"
        style={{ backgroundColor: item.color ?? item.payload?.fill }}
      />
      <div className="flex flex-1 items-center justify-between gap-3 leading-none">
        <span className="text-muted-foreground">{labels?.[key] ?? key}</span>
        <span className="font-mono font-medium tabular-nums text-foreground">
          {fmtVND(Number(value))}
        </span>
      </div>
    </>
  );
}
