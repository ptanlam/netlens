import { LineChart, PiggyBank, CreditCard } from "lucide-react";
import { fmtVND } from "@/lib/format";
import { cn } from "@/lib/utils";

export function NetWorthPanel({
  investments,
  savings,
  debts,
}: {
  investments: number;
  savings: number;
  debts: number;
}) {
  const net = investments + savings - debts;

  const parts: { label: string; value: number; sign: string; icon: typeof LineChart }[] = [
    { label: "Investments", value: investments, sign: "", icon: LineChart },
    { label: "Savings", value: savings, sign: "+", icon: PiggyBank },
    { label: "Debts", value: debts, sign: "−", icon: CreditCard },
  ];

  return (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 p-5 text-white shadow-lg shadow-violet-500/25 ring-1 ring-white/10 sm:p-6 dark:from-indigo-600 dark:via-violet-600 dark:to-fuchsia-700">
      {/* decorative glows */}
      <div className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-white/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 left-1/3 size-56 rounded-full bg-fuchsia-300/20 blur-3xl" />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-medium text-white/75">Net worth</div>
          <div
            className={cn(
              "mt-1 text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl",
              net < 0 && "text-rose-100",
            )}
          >
            {fmtVND(net)}
          </div>
          <div className="mt-1 text-sm text-white/70">Investments + Savings − Debts</div>
        </div>

        <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
          {parts.map((p) => (
            <div
              key={p.label}
              className="rounded-lg bg-white/10 px-3 py-2.5 ring-1 ring-white/15 backdrop-blur-sm transition-colors hover:bg-white/15"
            >
              <div className="flex items-center gap-1.5 text-xs text-white/70">
                <p.icon className="size-3.5" />
                {p.label}
              </div>
              <div className="mt-1 font-mono text-sm font-semibold tabular-nums sm:text-base">
                {p.sign}
                {fmtVND(p.value)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
