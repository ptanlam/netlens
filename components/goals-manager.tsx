"use client";

import * as React from "react";
import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { GOAL_METRICS, GOAL_METRIC_LABELS, type Goal, type GoalMetric } from "@/lib/types";
import { addGoal, archiveGoal, deleteGoal, updateGoal } from "@/app/actions";
import { fmtVND } from "@/lib/format";
import { shortfall, verdict, type GoalView } from "@/lib/goals";
import { GoalBar, GoalStatusChip } from "@/components/goal-strip";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type ActionResult = { ok: boolean; message: string };

/** Where each pace figure came from, said plainly — the projection is never a black box. */
const PACE_SOURCE_NOTE: Record<string, string> = {
  goal: "your monthly plan",
  planned: "your active recurring rules",
  actual: "your recent contributions",
  schedule: "the repayment schedule",
  none: "nothing yet",
};

function GoalForm({
  action,
  goal,
  current,
  onDone,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  goal?: Goal;
  /** Today's value of each metric — used to prefill a debt goal's starting balance. */
  current: Record<GoalMetric, number>;
  onDone?: () => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [metric, setMetric] = React.useState<GoalMetric>(goal?.metric ?? "net_worth");
  const formRef = React.useRef<HTMLFormElement>(null);

  // A debt counts DOWN, so its baseline is what you owe today (bar starts empty and
  // fills as you pay it off). Everything else counts up from zero, so the bar reads as
  // the share of the target you already have.
  const baselineDefault = goal?.baseline ?? (metric === "debts" ? Math.round(current.debts) : 0);
  const isDebt = metric === "debts";

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          const res = await action(fd);
          if (res.ok) {
            toast.success(res.message);
            if (!goal) formRef.current?.reset();
            onDone?.();
          } else toast.error(res.message);
        })
      }
      className="grid gap-4 sm:grid-cols-2"
    >
      <div className="grid gap-2">
        <Label htmlFor="g-name">Goal name</Label>
        <Input id="g-name" name="name" defaultValue={goal?.name} placeholder="e.g. House deposit" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="g-metric">Track</Label>
        <Select name="metric" value={metric} onValueChange={(v) => v && setMetric(v as GoalMetric)}>
          <SelectTrigger id="g-metric" className="w-full">
            {/* Base UI renders the raw value here by default ("net_worth"), so hand it the
                label instead. */}
            <SelectValue>{GOAL_METRIC_LABELS[metric]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {GOAL_METRICS.map((m) => (
              <SelectItem key={m} value={m}>
                {GOAL_METRIC_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="g-target">{isDebt ? "Target balance (VND)" : "Target amount (VND)"}</Label>
        <CurrencyInput
          id="g-target" name="target"
          defaultValue={goal?.target} placeholder={isDebt ? "0" : "1.000.000.000"} required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="g-baseline">{isDebt ? "Starting balance (VND)" : "Start progress from (VND)"}</Label>
        <CurrencyInput
          key={metric} // remount so the debt prefill lands when the metric changes
          id="g-baseline" name="baseline"
          defaultValue={baselineDefault}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="g-date">Target date (optional)</Label>
        <Input id="g-date" name="target_date" type="date" defaultValue={goal?.target_date ?? undefined} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="g-plan">Monthly plan (VND, optional)</Label>
        <CurrencyInput
          id="g-plan" name="monthly_plan"
          defaultValue={goal?.monthly_plan ?? undefined} placeholder="30.000.000"
        />
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="g-note">Note (optional)</Label>
        <Input id="g-note" name="note" defaultValue={goal?.note ?? undefined} />
      </div>
      <p className="text-[12px] text-muted-foreground sm:col-span-2">
        {isDebt
          ? "Without a monthly plan, the projection follows each debt's own repayment schedule."
          : "Without a monthly plan, the projection uses your active recurring rules — and market growth is counted as zero."}
      </p>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : goal ? "Update goal" : "Add goal"}
        </Button>
      </div>
    </form>
  );
}

function GoalCard({ view, current }: { view: GoalView; current: Record<GoalMetric, number> }) {
  const { goal, proj } = view;
  const [editOpen, setEditOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const archived = goal.archived === 1;
  const gap = shortfall(proj);

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    });

  return (
    <div className={cn("rounded-xl border border-border bg-card px-5 py-4", archived && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold">{goal.name}</span>
            <span className="rounded-[5px] bg-secondary px-[7px] py-0.5 font-mono text-[10px] text-muted-foreground">
              {GOAL_METRIC_LABELS[goal.metric]}
            </span>
            {!archived && <GoalStatusChip status={proj.status} />}
          </div>
          <div className="mt-1 font-mono text-[12px] text-muted-foreground tabular-nums">
            {fmtVND(proj.current)} / {fmtVND(goal.target)}
            {goal.target_date && ` · by ${goal.target_date}`}
            {goal.note && ` · ${goal.note}`}
          </div>
        </div>
        <div className="flex gap-1">
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit goal" />}>
              <Pencil className="size-3.5" />
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Edit goal</DialogTitle>
              </DialogHeader>
              <GoalForm
                action={(fd) => updateGoal(goal.id, fd)}
                goal={goal}
                current={current}
                onDone={() => setEditOpen(false)}
              />
            </DialogContent>
          </Dialog>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={archived ? "Restore goal" : "Archive goal"}
            title={archived ? "Restore goal" : "Archive goal"}
            disabled={pending}
            onClick={() => run(() => archiveGoal(goal.id, !archived))}
          >
            {archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete goal"
            disabled={pending}
            onClick={() => {
              if (!confirm(`Delete the goal "${goal.name}"?`)) return;
              run(() => deleteGoal(goal.id));
            }}
          >
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="mt-3.5 flex items-center gap-3">
        <GoalBar progress={proj.progress} muted={archived || proj.status === "stalled"} />
        <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground tabular-nums">
          {Math.round(proj.progress * 100)}%
        </span>
      </div>

      {!archived && (
        <div className="mt-3.5 grid gap-x-6 gap-y-1.5 border-t border-divider pt-3 text-[12px] sm:grid-cols-2">
          <div className="text-muted-foreground">
            <span className="text-foreground">{verdict(goal, proj)}</span>
            {proj.status !== "hit" && (
              <>
                {" · "}
                {proj.remaining > 0 ? `${fmtVND(proj.remaining)} to go` : "target met"}
              </>
            )}
          </div>
          <div className="font-mono text-muted-foreground tabular-nums sm:text-right">
            {proj.paceSource === "schedule"
              ? "Following the repayment schedule"
              : proj.pace > 0
                ? `${fmtVND(proj.pace)}/mo from ${PACE_SOURCE_NOTE[proj.paceSource]}`
                : "No pace set"}
          </div>
          {proj.requiredPerMonth != null && proj.requiredPerMonth > 0 && (
            <div className="text-muted-foreground sm:col-span-2">
              Needs{" "}
              <span className="font-mono text-foreground tabular-nums">
                {fmtVND(proj.requiredPerMonth)}/mo
              </span>{" "}
              {/* On a debt's own schedule this is money ON TOP of the payments already
                  planned, not a pace to replace them — so it can't be compared to `pace`. */}
              {proj.requiredIsExtra ? "on top of your scheduled payments" : ""} to land on{" "}
              {goal.target_date}
              {gap > 0 && (
                <span className="text-(--chart-negative)">
                  {" — "}
                  <span className="font-mono tabular-nums">{fmtVND(gap)}/mo</span> more than your
                  current pace
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function GoalsManager({
  goals,
  current,
}: {
  goals: GoalView[];
  current: Record<GoalMetric, number>;
}) {
  const active = goals.filter((g) => g.goal.archived === 0);
  const archived = goals.filter((g) => g.goal.archived === 1);

  return (
    <div className="flex flex-col gap-4">
      {active.length === 0 && (
        <p className="text-[13px] text-muted-foreground">
          No goals yet. Add one below — a target on net worth, investments, savings, or debts.
        </p>
      )}
      {active.map((view) => (
        <GoalCard key={view.goal.id} view={view} current={current} />
      ))}

      <div className="rounded-xl border border-border bg-card px-6 py-[22px]">
        <div className="mb-[18px] font-serif text-[17px] font-semibold">New goal</div>
        <GoalForm action={addGoal} current={current} />
      </div>

      {archived.length > 0 && (
        <>
          <div className="mt-2 font-mono text-[10.5px] tracking-[0.08em] text-faint uppercase">
            Archived
          </div>
          {archived.map((view) => (
            <GoalCard key={view.goal.id} view={view} current={current} />
          ))}
        </>
      )}
    </div>
  );
}
