"use client";

import * as React from "react";
import {
  ChevronDown, ChevronLeft, ChevronRight, Download, Landmark, Layers, Trash2,
  TrendingDown, TrendingUp, Wallet,
} from "lucide-react";
import { toast } from "sonner";
import type { Instrument, RecurringRule, Tx } from "@/lib/types";
import { deleteHolding } from "@/app/actions";
import { fmtVND } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/stat-card";
import { AddHoldingDialog, EditHoldingDialog } from "@/components/add-holding-dialog";
import { AddTxDialog } from "@/components/add-tx-dialog";
import { AddRecurringDialog } from "@/components/add-recurring-dialog";
import { TxRowActions } from "@/components/tx-row-actions";
import { type InstrumentOption } from "@/components/tx-form";
import { RecurringManager } from "@/components/recurring-manager";
import { RefreshPricesControls } from "@/components/refresh-prices";
import { cn } from "@/lib/utils";

export interface HoldingView {
  inst: Instrument;
  value: number;
  cost: number;
  pnl: number;
  live: boolean;
}

type RuleView = { rule: RecurringRule; nextDue: string | null };

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
    <div className="flex items-center gap-3 border-b py-1.5 text-sm last:border-0">
      <span className="whitespace-nowrap tabular-nums text-muted-foreground">{tx.date}</span>
      <span className={cn("whitespace-nowrap font-mono font-medium tabular-nums", tx.amount < 0 && "text-(--chart-negative)")}>
        {fmtVND(tx.amount)}
      </span>
      <span className="whitespace-nowrap tabular-nums text-muted-foreground">
        {tx.quantity != null ? `${tx.quantity} u` : "—"}
      </span>
      <span className="flex-1 truncate text-muted-foreground">{tx.note}</span>
      <TxRowActions tx={tx} instruments={[option]} />
    </div>
  );
}

const TX_PAGE_SIZE = 10;

/** Client-side paging: the page's transactions are already fully loaded, so there's
 *  nothing to fetch. `page` is clamped rather than stored so deleting the last row on
 *  the last page falls back to a valid page instead of showing an empty list. */
function TxList({ txs, option }: { txs: Tx[]; option: InstrumentOption }) {
  const [page, setPage] = React.useState(0);

  const pageCount = Math.max(1, Math.ceil(txs.length / TX_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * TX_PAGE_SIZE;
  const visible = txs.slice(start, start + TX_PAGE_SIZE);

  return (
    <>
      <div className="rounded-lg border bg-card px-3">
        {visible.map((tx) => (
          <TxRow key={tx.id} tx={tx} option={option} />
        ))}
      </div>
      {pageCount > 1 && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span className="tabular-nums">
            Page {safePage + 1} of {pageCount} · {txs.length} tx
            {txs.length === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(safePage - 1)}
              disabled={safePage === 0}
            >
              <ChevronLeft className="size-3.5" /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(safePage + 1)}
              disabled={safePage >= pageCount - 1}
            >
              Next <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function HoldingCard({ holding, txs, rules, sourceKeys }: { holding: HoldingView; txs: Tx[]; rules: RuleView[]; sourceKeys: string[] }) {
  const [open, setOpen] = React.useState(false);
  const { inst, value, pnl, cost, live } = holding;
  const option: InstrumentOption = { name: inst.name, asset_type: inst.asset_type };
  const pnlPct = cost ? (pnl / cost) * 100 : 0;
  // Configured for a live price, but holdingValue() is falling back to manual_value —
  // i.e. the feed never populated, or quantity was cleared. Otherwise invisible.
  const usesFallback = inst.price_source !== "manual" && !live;

  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{inst.name}</span>
            <Badge variant="secondary">{inst.asset_type}</Badge>
            {live && (
              <Badge variant="outline" className="border-transparent bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">
                live
              </Badge>
            )}
            {usesFallback && (
              <Badge
                variant="outline"
                title={`No live price from ${inst.price_source} — showing the fallback value instead.`}
                className="border-transparent bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
              >
                fallback value
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {inst.quantity != null && inst.last_price != null
              ? `${inst.quantity} × ${inst.last_price.toLocaleString()}`
              : "manual value"}
            {" · "}
            {txs.length} tx{txs.length === 1 ? "" : "s"}
            {rules.length > 0 && ` · ${rules.length} rule${rules.length === 1 ? "" : "s"}`}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono font-semibold tabular-nums">{fmtVND(value)}</div>
          <div className={cn("font-mono text-xs tabular-nums", pnl >= 0 ? "text-(--chart-positive)" : "text-(--chart-negative)")}>
            {pnl >= 0 ? "+" : ""}
            {fmtVND(pnl)} ({pnl >= 0 ? "+" : ""}
            {pnlPct.toFixed(1)}%)
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t bg-muted/20 px-4 py-4">
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>Source: {inst.price_source}</span>
            {inst.symbol && <span>Symbol: {inst.symbol}</span>}
            <span>Cost: {fmtVND(cost)}</span>
            {usesFallback && (
              <span className="text-amber-700 dark:text-amber-300">
                No {inst.price_source} price{inst.quantity == null ? " or quantity" : ""} yet —
                valued at the fallback value. Try “Refresh prices”.
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <EditHoldingDialog holding={inst} sources={sourceKeys} />
              <DeleteHoldingButton name={inst.name} />
            </div>
          </div>

          <section className="mb-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-medium">Transactions</h4>
              <div className="flex flex-wrap items-center gap-2">
                <AddTxDialog instruments={[option]} />
                <AddRecurringDialog instruments={[option]} />
              </div>
            </div>
            {txs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transactions yet.</p>
            ) : (
              <TxList txs={txs} option={option} />
            )}
          </section>

          <section>
            <h4 className="mb-2 text-sm font-medium">Recurring</h4>
            <RecurringManager rules={rules} instruments={[option]} showAddForm={false} />
          </section>
        </div>
      )}
    </div>
  );
}

type HoldingGroup = {
  type: string;
  holdings: HoldingView[];
  value: number;
  cost: number;
  pnl: number;
};

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
  txsByInstrument,
  rulesByInstrument,
  sourceKeys,
}: {
  holdings: HoldingView[];
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

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard index={0} tone="violet" icon={Wallet} label="Portfolio value" value={fmtVND(totalValue)} />
        <StatCard index={1} tone="sky" icon={Landmark} label="Total invested" value={fmtVND(totalCost)} />
        <StatCard
          index={2}
          tone={totalPnl >= 0 ? "emerald" : "rose"}
          icon={totalPnl >= 0 ? TrendingUp : TrendingDown}
          label="Total P&L"
          value={`${totalPnl >= 0 ? "+" : ""}${fmtVND(totalPnl)}`}
          valueClassName={totalPnl >= 0 ? "text-(--chart-positive)" : "text-(--chart-negative)"}
          sub={`${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% of invested`}
        />
        <StatCard index={3} tone="amber" icon={Layers} label="Holdings" value={String(holdings.length)} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Expand a holding to manage its transactions and recurring rules.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <RefreshPricesControls />
          <Button variant="outline" size="sm" nativeButton={false} render={<a href="/export.csv" download />}>
            <Download className="size-3.5" />
            Export CSV
          </Button>
          <AddRecurringDialog instruments={options} />
          <AddTxDialog instruments={options} />
          <AddHoldingDialog sources={sourceKeys} />
        </div>
      </div>

      {holdings.length === 0 ? (
        <p className="text-sm text-muted-foreground">No holdings yet — add one to start tracking.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.type} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b pb-2">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-semibold">{group.type}</h3>
                  <span className="text-xs text-muted-foreground">
                    {group.holdings.length} holding{group.holdings.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 font-mono text-sm tabular-nums">
                  <span className="font-semibold">{fmtVND(group.value)}</span>
                  <span className={cn("text-xs", group.pnl >= 0 ? "text-(--chart-positive)" : "text-(--chart-negative)")}>
                    {group.pnl >= 0 ? "+" : ""}
                    {fmtVND(group.pnl)}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                {group.holdings.map((h) => (
                  <HoldingCard
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
