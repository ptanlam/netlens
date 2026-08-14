"use client";

import * as React from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, ArrowRight, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Instrument, RecurringRule } from "@/lib/types";
import { deleteHolding, setHoldingArchived } from "@/app/actions";
import { fmtUnits, fmtVND } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/tooltip";
import { AddHoldingDialog, EditHoldingDialog } from "@/components/add-holding-dialog";
import { AddTxDialog } from "@/components/add-tx-dialog";
import { AddRecurringDialog } from "@/components/add-recurring-dialog";
import { type InstrumentOption } from "@/components/tx-form";
import { RecurringManager } from "@/components/recurring-manager";
import { SummaryCards, type Stat } from "@/components/stat-card";
import { PageHeader } from "@/components/page-header";
import { EntityAvatar } from "@/components/entity-avatar";
import { holdingLogo } from "@/lib/logos";
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
  Funds: "var(--chart-1)",
  Stocks: "var(--chart-2)",
  Crypto: "var(--chart-3)",
  "Real Estate": "var(--chart-4)",
};
const typeColor = (t: string) => TYPE_COLORS[t] ?? "var(--chart-5)";

function DeleteHoldingButton({ name }: { name: string }) {
  const [pending, startTransition] = React.useTransition();
  return (
    <IconTooltip label="Delete holding">
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
    </IconTooltip>
  );
}

function ArchiveHoldingButton({ name, archived }: { name: string; archived: boolean }) {
  const [pending, startTransition] = React.useTransition();
  return (
    <IconTooltip label={archived ? "Restore to active holdings" : "Archive — hides it, keeps its history"}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={archived ? "Restore holding" : "Archive holding"}
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const res = await setHoldingArchived(name, !archived);
            if (res.ok) toast.success(res.message);
            else toast.error(res.message);
          });
        }}
      >
        {archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5 text-muted-foreground" />}
      </Button>
    </IconTooltip>
  );
}

/** Shown on a holding you've sold out of but not yet filed away. Archiving is what stops
 *  it being quoted on every tick and backfilled every twelve hours (`isDormant` in
 *  lib/db.ts) — zero units already keep it off the dashboard, so nothing else says so. */
function SoldOutPrompt({ name }: { name: string }) {
  const [pending, startTransition] = React.useTransition();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-pane-sunk px-3 py-2 text-[12.5px] text-muted-foreground">
      <span>Sold out — no units left. Its transactions and P&amp;L history are kept either way.</span>
      <button
        type="button"
        className="font-medium text-accent-brand hover:underline disabled:opacity-60"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await setHoldingArchived(name, true);
            if (res.ok) toast.success(res.message);
            else toast.error(res.message);
          })
        }
      >
        {pending ? "Archiving…" : "Archive it"}
      </button>
    </div>
  );
}

function HoldingRow({ holding, txCount, rules, sourceKeys }: { holding: HoldingView; txCount: number; rules: RuleView[]; sourceKeys: string[] }) {
  const [open, setOpen] = React.useState(false);
  const { inst, value, pnl, cost, live } = holding;
  const option: InstrumentOption = { name: inst.name, asset_type: inst.asset_type };
  // A percentage only means something against real money put in. Once a holding is sold
  // out its net cost goes negative (you took out more than you put in), so the ratio is
  // nonsense — show just the absolute realised P&L there.
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : null;
  const usesFallback = inst.price_source !== "manual" && !live;
  // Exactly zero units — sold out. Null is a different thing (units unknown: a fund
  // awaiting confirmation, or a manually-valued holding), and must not be flagged.
  const soldOut = inst.quantity === 0 && inst.archived !== 1;

  return (
    <div className="border-t border-divider-soft first:border-t-0">
      <div
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }}
        className="flex cursor-pointer items-center justify-between gap-3 px-[18px] py-3.5"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn("inline-block font-mono text-[12px] text-faint transition-transform", open && "rotate-90")}>▸</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <EntityAvatar name={inst.name} color={typeColor(inst.asset_type)} logo={holdingLogo(inst.name, inst.symbol)} />
              <span className="truncate text-[14px] font-semibold">{inst.name}</span>
              <Badge variant="tag">{inst.asset_type}</Badge>
              {live && !soldOut && <Badge variant="accent">live</Badge>}
              {soldOut && <Badge variant="secondary">sold out</Badge>}
              {usesFallback && (
                <Badge variant="warning" title={`No live price from ${inst.price_source} — showing the fallback value.`}>
                  fallback
                </Badge>
              )}
            </div>
            <div className="mt-1 font-mono text-[11.5px] text-faint tabular-nums">
              {inst.quantity != null && inst.last_price != null
                ? `${fmtUnits(inst.quantity)} × ${inst.last_price.toLocaleString("de-DE")}`
                : "manual value"}
              {" · "}{txCount} tx{txCount === 1 ? "" : "s"}
              {rules.length > 0 && ` · ${rules.length} rule${rules.length === 1 ? "" : "s"}`}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[14px] tabular-nums">{fmtVND(value)}</div>
          <div className={cn("mt-1 font-mono text-[11.5px] tabular-nums", pnl >= 0 ? "text-accent-brand" : "text-(--chart-negative)")}>
            {pnl >= 0 ? "+" : ""}{fmtVND(pnl)}{pnlPct != null && ` (${pnl >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`}
          </div>
        </div>
      </div>

      {open && (
        <div className="border-t border-divider-soft bg-pane-sunk px-[18px] py-4 pl-[41px]">
          {soldOut && <SoldOutPrompt name={inst.name} />}
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
            <span>Source: {inst.price_source}</span>
            {inst.symbol && <span>Symbol: {inst.symbol}</span>}
            <span>Cost: {fmtVND(cost)}</span>
            <div className="ml-auto flex items-center gap-1">
              <EditHoldingDialog holding={inst} sources={sourceKeys} />
              <ArchiveHoldingButton name={inst.name} archived={inst.archived === 1} />
              <DeleteHoldingButton name={inst.name} />
            </div>
          </div>

          {/* The ledger itself lives on /transactions — this is the way through to it, with
              the filter already set. A holding's own rows used to be paged five at a time
              right here, which was a second, weaker copy of a table that page does properly
              (sorting, units, price, the lot). */}
          <div className="mb-5">
            {txCount === 0 ? (
              <p className="text-[13px] text-muted-foreground">No transactions recorded.</p>
            ) : (
              <Link
                href={`/transactions?holding=${encodeURIComponent(inst.name)}`}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-brand hover:underline"
              >
                {txCount} transaction{txCount === 1 ? "" : "s"}
                <ArrowRight className="size-3.5" />
              </Link>
            )}
          </div>

          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-[13px] font-semibold">Recurring</h4>
              <AddRecurringDialog instruments={[option]} />
            </div>
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
  txCountBy,
  rulesByInstrument,
  sourceKeys,
  banner,
}: {
  holdings: HoldingView[];
  /** How many transactions each holding has. A count, not the rows: the rows are
   *  /transactions' job, and shipping every one of them here was most of this page's
   *  payload for a list you had to expand a holding to see. */
  txCountBy: Record<string, number>;
  rulesByInstrument: Record<string, RuleView[]>;
  sourceKeys: string[];
  /** Page-level alert. Rendered under the heading, because the design opens every view
   *  with its <h1> — a banner above it pushes the page title off the top of the screen. */
  banner?: React.ReactNode;
}) {
  // Totals stay over every holding so archiving a sold-out one never moves a KPI — its
  // value is 0 and its realised P&L is preserved. Archived rows only leave the live list.
  const totalValue = holdings.reduce((a, h) => a + h.value, 0);
  const totalCost = holdings.reduce((a, h) => a + h.cost, 0);
  const totalPnl = totalValue - totalCost;
  const pnlPct = totalCost ? (totalPnl / totalCost) * 100 : 0;

  const active = holdings.filter((h) => h.inst.archived !== 1);
  const archived = holdings.filter((h) => h.inst.archived === 1);
  const options: InstrumentOption[] = active.map((h) => ({ name: h.inst.name, asset_type: h.inst.asset_type }));
  const groups = groupByType(active);
  const typeCount = new Set(active.map((h) => h.inst.asset_type)).size;

  const kpis: Stat[] = [
    { label: "Portfolio value", value: fmtVND(totalValue), sub: "Live · quantity × price" },
    { label: "Total invested", value: fmtVND(totalCost), sub: "Cost basis, all time" },
    {
      label: "Total P&L",
      value: `${totalPnl >= 0 ? "+" : "−"}₫${Math.abs(Math.round(totalPnl)).toLocaleString("de-DE")}`,
      tone: totalPnl >= 0 ? "gain" : "loss",
      sub: `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% of invested`,
    },
    { label: "Holdings", value: String(active.length), sub: `across ${typeCount} asset type${typeCount === 1 ? "" : "s"}` },
  ];

  return (
    <div>
      {/* The design lifts a page's actions up beside its title rather than stranding them
          in a bar under the summary tiles — price refresh stays in the header, so it isn't
          repeated here. */}
      <PageHeader
        title="Investments"
        className="mb-4"
        actions={
          <>
            <AddRecurringDialog instruments={options} />
            <AddTxDialog instruments={options} />
            <AddHoldingDialog sources={sourceKeys} />
          </>
        }
      >
        What you hold now, what it cost and what it&apos;s worth — grouped by asset type.
      </PageHeader>

      {banner && <div className="mb-4">{banner}</div>}

      <SummaryCards stats={kpis} />

      <div className="mt-6 mb-3.5">
        <div className="text-[16px] font-bold tracking-[-0.01em]">Holdings</div>
        <div className="mt-0.5 text-[12.5px] text-muted-foreground">Select a holding for its price source, rules and history</div>
      </div>

      {active.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          {archived.length > 0
            ? "No active holdings — they're all archived."
            : "No holdings yet — add one to start tracking."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <section key={group.type}>
              <div className="flex items-center justify-between px-1 pb-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="size-[9px] rounded-[2px]" style={{ background: typeColor(group.type) }} />
                  <span className="text-[14px] font-semibold">{group.type}</span>
                  <span className="text-[12px] text-faint">
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
              <div className="overflow-hidden card-surface">
                {group.holdings.map((h) => (
                  <HoldingRow
                    key={h.inst.name}
                    holding={h}
                    txCount={txCountBy[h.inst.name] ?? 0}
                    rules={rulesByInstrument[h.inst.name] ?? []}
                    sourceKeys={sourceKeys}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <ArchivedHoldings
          holdings={archived}
          txCountBy={txCountBy}
          rulesByInstrument={rulesByInstrument}
          sourceKeys={sourceKeys}
        />
      )}
    </div>
  );
}

/**
 * Archived holdings, tucked below the live portfolio and collapsed by default. Archiving
 * only hides a holding from the active list — its value and P&L still count in the KPIs
 * above and in net worth. Reversible any time via Restore.
 */
function ArchivedHoldings({
  holdings,
  txCountBy,
  rulesByInstrument,
  sourceKeys,
}: {
  holdings: HoldingView[];
  txCountBy: Record<string, number>;
  rulesByInstrument: Record<string, RuleView[]>;
  sourceKeys: string[];
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <section className="mt-8">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 px-1 pb-2.5 text-left"
      >
        <Archive className="size-3.5 text-faint" />
        <span className="text-[14px] font-semibold text-muted-foreground">Archived</span>
        <span className="text-[12px] text-faint">
          {holdings.length} holding{holdings.length === 1 ? "" : "s"}
        </span>
        <span className={cn("ml-1 font-mono text-[12px] text-faint transition-transform", open && "rotate-90")}>▸</span>
      </button>
      {open && (
        <div className="overflow-hidden card-surface opacity-80">
          {holdings.map((h) => (
            <HoldingRow
              key={h.inst.name}
              holding={h}
              txCount={txCountBy[h.inst.name] ?? 0}
              rules={rulesByInstrument[h.inst.name] ?? []}
              sourceKeys={sourceKeys}
            />
          ))}
        </div>
      )}
    </section>
  );
}
