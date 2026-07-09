import { fmtVND } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
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

  const parts: { label: string; value: number; sign: string; className?: string }[] = [
    { label: "Investments", value: investments, sign: "" },
    { label: "Savings", value: savings, sign: "+" },
    { label: "Debts", value: debts, sign: "−", className: "text-(--chart-negative)" },
  ];

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm text-muted-foreground">Net worth</div>
          <div
            className={cn(
              "mt-1 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl",
              net < 0 && "text-(--chart-negative)",
            )}
          >
            {fmtVND(net)}
          </div>
          <div className="mt-0.5 text-sm text-muted-foreground">
            Investments + Savings − Debts
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 sm:gap-8">
          {parts.map((p) => (
            <div key={p.label}>
              <div className="text-sm text-muted-foreground">{p.label}</div>
              <div className={cn("mt-1 font-mono font-medium tabular-nums", p.className)}>
                {p.sign}
                {fmtVND(p.value)}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
