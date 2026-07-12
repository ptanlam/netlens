"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Instrument, RecurringRule, Tx } from "@/lib/types";
import { deleteHolding } from "@/app/actions";
import { fmtVND } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { AddHoldingDialog, EditHoldingDialog } from "@/components/add-holding-dialog";
import { AddTxDialog } from "@/components/add-tx-dialog";
import { AddRecurringDialog } from "@/components/add-recurring-dialog";
import { TxRowActions } from "@/components/tx-row-actions";
import { type InstrumentOption } from "@/components/tx-form";
import { RecurringManager } from "@/components/recurring-manager";
import { RefreshPricesControls } from "@/components/refresh-prices";
import { InvestmentActivity } from "@/components/investment-activity";
import { cn } from "@/lib/utils";

export interface HoldingView {
  inst: Instrument;
  value: number;
  cost: number;
  pnl: number;
  live: boolean;
}

type RuleView = { rule: RecurringRule; nextDue: string | null };

const TYPE_COLORS: Record<string, string> = {
  Funds: "#c2b48f",
  Stocks: "#2b2924",
  Crypto: "#c07a3f",
  "Real Estate": "#857f70",
};
const typeColor = (t: string) => TYPE_COLORS[t] ?? "#2f7d55";

function DeleteHoldingButton({ name }: { name: string }) {
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Delete holding"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Delete the holding "${name}"? Only works if it has no transactions or rules.`)) return;
        startTransition(async () => {
          const res = await deleteHolding(name);
          if (res.ok) toast.success(res.message);
          else toast.error(res.message);
        });
      }}
    >
      <Trash2 className="size-3.5 text-destructive" />
    </Button>
  );
}

function TxRow({ tx, option }: { tx: Tx; option: InstrumentOption }) {
  return (
    <div className="flex items-center gap-3 border-b border-[#f0ede6] py-2 text-sm last:border-0">
      <span className="font-mono whitespace-nowrap tabular-nums text-muted-foreground">{tx.date}</span>
      <span className={cn("font-mono whitespace-nowrap font-medium tabular-nums", tx.amount < 0 && "text-(--chart-negative)")}>
        {fmtVND(tx.amount)}
      </span>
      <span className="font-mono whitespace-nowrap tabular-nums text-muted-foreground">
        {tx.quantity != null ? `${tx.quantity} u` : "—"}
      </span>
      <span className="flex-1 truncate text-muted-foreground">{tx.note}</span>
      <TxRowActions tx={tx} instruments={[option]} />
    </div>
  );
}

const TX_PAGE_SIZE = 5;

/** Paged, with a fixed-height row area so a partial last page doesn't shrink the
 *  panel — expanding different holdings no longer makes the layout jump. */
function TxList({ txs, option }: { txs: Tx[]; option: InstrumentOption }) {
  const [page, setPage] = React.useState(0);
  const pageCount = Math.max(1, Math.ceil(txs.length / TX_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * TX_PAGE_SIZE;
  const visible = txs.slice(start, start + TX_PAGE_SIZE);

  return (
    <>
      <div className="h-[225px] overflow-y-hidden rounded-lg border border-border bg-card px-3">
        {visible.map((tx) => (
          <TxRow key={tx.id} tx={tx} option={option} />
        ))}
      </div>
      {pageCount > 1 && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span className="font-mono tabular-nums">
            Page {safePage + 1} of {pageCount} · {txs.length} tx{txs.length === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(safePage - 1)} disabled={safePage === 0}>
              <ChevronLeft className="size-3.5" /> Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage(safePage + 1)} disabled={safePage >= pageCount - 1}>
              Next <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function HoldingRow({ holding, txs, rules, sourceKeys }: { holding: HoldingView; txs: Tx[]; rules: RuleView[]; sourceKeys: string[] }) {
  const [open, setOpen] = React.useState(false);
  const { inst, value, pnl, cost, live } = holding;
  const option: InstrumentOption = { name: inst.name, asset_type: inst.asset_type };
  const pnlPct = cost ? (pnl / cost) * 100 : 0;
  const usesFallback = inst.price_source !== "manual" && !live;

  return (
    <div className="border-t border-[#f0ede6] first:border-t-0">
      <div
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }}
        className="flex cursor-pointer items-center justify-between gap-3 px-[18px] py-3.5"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn("inline-block font-mono text-[12px] text-[#a5a29a] transition-transform", open && "rotate-90")}>▸</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[14px] font-semibold">{inst.name}</span>
              <span className="rounded-[5px] bg-background px-[7px] py-0.5 font-mono text-[10px] text-muted-foreground">{inst.asset_type}</span>
              {live && <span className="rounded-[5px] bg-accent px-[7px] py-0.5 font-mono text-[10px] text-accent-brand">live</span>}
              {usesFallback && (
                <span title={`No live price from ${inst.price_source} — showing the fallback value.`} className="rounded-[5px] bg-[#fbf1e6] px-[7px] py-0.5 font-mono text-[10px] text-[#c07a3f]">
                  fallback
                </span>
              )}
            </div>
            <div className="mt-1 font-mono text-[11.5px] text-[#a5a29a] tabular-nums">
              {inst.quantity != null && inst.last_price != null
                ? `${inst.quantity} × ${inst.last_price.toLocaleString("de-DE")}`
                : "manual value"}
              {" · "}{txs.length} tx{txs.length === 1 ? "" : "s"}
              {rules.length > 0 && ` · ${rules.length} rule${rules.length === 1 ? "" : "s"}`}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[14px] tabular-nums">{fmtVND(value)}</div>
          <div className={cn("mt-1 font-mono text-[11.5px] tabular-nums", pnl >= 0 ? "text-accent-brand" : "text-(--chart-negative)")}>
            {pnl >= 0 ? "+" : ""}{fmtVND(pnl)} ({pnl >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)
          </div>
        </div>
      </div>

      {open && (
        <div className="border-t border-[#f0ede6] bg-muted px-[18px] py-4 pl-[41px]">
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
            <span>Source: {inst.price_source}</span>
            {inst.symbol && <span>Symbol: {inst.symbol}</span>}
            <span>Cost: {fmtVND(cost)}</span>
            <div className="ml-auto flex items-center gap-1">
              <EditHoldingDialog holding={inst} sources={sourceKeys} />
              <DeleteHoldingButton name={inst.name} />
            </div>
          </div>

          <section className="mb-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-[13px] font-semibold">Transactions</h4>
              <div className="flex flex-wrap items-center gap-2">
                <AddTxDialog instruments={[option]} />
                <AddRecurringDialog instruments={[option]} />
              </div>
            </div>
            {txs.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No transactions recorded.</p>
            ) : (
              <TxList txs={txs} option={option} />
            )}
          </section>

          <section>
            <h4 className="mb-2 text-[13px] font-semibold">Recurring</h4>
            <RecurringManager rules={rules} instruments={[option]} showAddForm={false} />
          </section>
        </div>
      )}
    </div>
  );
}

type HoldingGroup = { type: string; holdings: HoldingView[]; value: number; cost: number; pnl: number };

function groupByType(holdings: HoldingView[]): HoldingGroup[] {
  const byType = new Map<string, HoldingView[]>();
  for (const h of holdings) {
    const list = byType.get(h.inst.asset_type);
    if (list) list.push(h);
    else byType.set(h.inst.asset_type, [h]);
  }
  return Array.from(byType, ([type, hs]) => {
    const value = hs.reduce((a, h) => a + h.value, 0);
    const cost = hs.reduce((a, h) => a + h.cost, 0);
    return { type, holdings: hs, value, cost, pnl: value - cost };
  }).sort((a, b) => b.value - a.value || a.type.localeCompare(b.type));
}

export function InvestmentManager({
  holdings,
  allTxs,
  txsByInstrument,
  rulesByInstrument,
  sourceKeys,
}: {
  holdings: HoldingView[];
  allTxs: Tx[];
  txsByInstrument: Record<string, Tx[]>;
  rulesByInstrument: Record<string, RuleView[]>;
  sourceKeys: string[];
}) {
  const totalValue = holdings.reduce((a, h) => a + h.value, 0);
  const totalCost = holdings.reduce((a, h) => a + h.cost, 0);
  const totalPnl = totalValue - totalCost;
  const pnlPct = totalCost ? (totalPnl / totalCost) * 100 : 0;
  const options: InstrumentOption[] = holdings.map((h) => ({ name: h.inst.name, asset_type: h.inst.asset_type }));
  const groups = groupByType(holdings);
  const typeCount = new Set(holdings.map((h) => h.inst.asset_type)).size;

  const kpis = [
    { label: "Portfolio value", value: fmtVND(totalValue) },
    { label: "Total invested", value: fmtVND(totalCost) },
    {
      label: "Total P&L",
      value: `${totalPnl >= 0 ? "+" : "−"}₫${Math.abs(Math.round(totalPnl)).toLocaleString("de-DE")}`,
      valueCls: totalPnl >= 0 ? "text-accent-brand" : "text-(--chart-negative)",
      sub: `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% of invested`,
      subCls: totalPnl >= 0 ? "text-accent-brand" : "text-(--chart-negative)",
    },
    { label: "Holdings", value: String(holdings.length), sub: `across ${typeCount} asset type${typeCount === 1 ? "" : "s"}` },
  ];

  return (
    <div>
      <div className="mb-3.5">
        <div className="font-serif text-[22px] font-semibold tracking-[-0.01em]">Investments</div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">
          Your holdings, their transactions, and the recurring rules that automate them — grouped by asset type.
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-4">
        {kpis.map((k, i) => (
          <div key={k.label} className={cn("px-4 py-4 sm:px-5 sm:py-[18px]", i % 2 === 0 && "border-r border-[#edeae3]", i < 3 && "lg:border-r lg:border-[#edeae3]")}>
            <div className="font-mono text-[10.5px] tracking-[0.08em] text-[#a5a29a] uppercase">{k.label}</div>
            <div className={cn("mt-[7px] font-mono text-[17px] tracking-[-0.01em] tabular-nums sm:text-[22px]", k.valueCls)}>{k.value}</div>
            {k.sub && <div className={cn("mt-[3px] text-[11.5px] text-muted-foreground", k.subCls)}>{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <RefreshPricesControls />
        <Button variant="outline" size="sm" nativeButton={false} render={<a href="/export.csv" download />}>
          <Download className="size-3.5" />
          Export CSV
        </Button>
        <div className="flex-1" />
        <AddRecurringDialog instruments={options} />
        <AddTxDialog instruments={options} />
        <AddHoldingDialog sources={sourceKeys} />
      </div>

      <InvestmentActivity txs={allTxs} options={options} />

      <div className="mt-6 mb-3.5">
        <div className="font-serif text-[19px] font-semibold">Holdings</div>
        <div className="mt-0.5 text-[12.5px] text-muted-foreground">Select a holding to see its transactions</div>
      </div>

      {holdings.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No holdings yet — add one to start tracking.</p>
      ) : (
        <div className="flex flex-col gap-[22px]">
          {groups.map((group) => (
            <section key={group.type}>
              <div className="flex items-center justify-between px-1 pb-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="size-[9px] rounded-[2px]" style={{ background: typeColor(group.type) }} />
                  <span className="text-[14px] font-semibold">{group.type}</span>
                  <span className="text-[12px] text-[#a5a29a]">
                    {group.holdings.length} holding{group.holdings.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="flex items-baseline gap-3 font-mono tabular-nums">
                  <span className="text-[14px]">{fmtVND(group.value)}</span>
                  <span className={cn("text-[12.5px]", group.pnl >= 0 ? "text-accent-brand" : "text-(--chart-negative)")}>
                    {group.pnl >= 0 ? "+" : ""}{fmtVND(group.pnl)}
                  </span>
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                {group.holdings.map((h) => (
                  <HoldingRow
                    key={h.inst.name}
                    holding={h}
                    txs={txsByInstrument[h.inst.name] ?? []}
                    rules={rulesByInstrument[h.inst.name] ?? []}
                    sourceKeys={sourceKeys}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
