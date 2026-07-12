import { fmtVND } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Editorial net-worth hero: a large mono figure with a breakdown rail. */
export function NetWorthPanel({
  investments,
  savings,
  debts,
  todayDelta,
}: {
  investments: number;
  savings: number;
  debts: number;
  /** Day-over-day P&L move; null while the series is still loading. */
  todayDelta?: number | null;
}) {
  const net = investments + savings - debts;

  const parts = [
    { label: "Investments", value: investments, sign: "", cls: "text-foreground" },
    { label: "Savings", value: savings, sign: "+", cls: "text-accent-brand" },
    { label: "Debts", value: debts, sign: "−", cls: "text-(--chart-negative)" },
  ];

  return (
    <div className="flex flex-wrap items-end justify-between gap-10">
      <div>
        <div className="font-mono text-[11px] tracking-[0.14em] text-[#a5a29a] uppercase">
          Net worth
        </div>
        <div className="mt-2.5 font-mono text-[44px] leading-[0.95] font-medium tracking-[-0.03em] text-foreground tabular-nums sm:text-[56px]">
          {fmtVND(net)}
        </div>
        <div className="mt-3.5 flex flex-wrap items-center gap-3.5">
          <span className="text-[13px] text-muted-foreground">
            Investments + Savings − Debts
          </span>
          {todayDelta != null && todayDelta !== 0 && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-[3px] font-mono text-[12px] tabular-nums",
                todayDelta < 0
                  ? "bg-[#f6eae7] text-(--chart-negative)"
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
              i < parts.length - 1 && "border-b border-[#edeae3]",
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
