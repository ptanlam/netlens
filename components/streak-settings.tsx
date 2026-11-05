"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { saveStreakCommitment } from "@/app/actions";
import { fmtVND } from "@/lib/format";
import { commitment } from "@/lib/score";
import type { CommitmentMode, StreakCommitment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Label } from "@/components/ui/label";
import { Amt } from "@/components/amt";
import { cn } from "@/lib/utils";

/**
 * Settings → Saving streak: where the monthly bar comes from. Every option quotes what it
 * comes to today, so picking one is never a guess about what the streak will be judged on.
 */
export function StreakSettings({
  setting,
  recurring,
  goalPlans,
}: {
  setting: StreakCommitment;
  /** ₫/month from your active recurring rules. */
  recurring: number;
  /** ₫/month across your goals' monthly plans. */
  goalPlans: number;
}) {
  const [mode, setMode] = React.useState<CommitmentMode>(setting.mode);
  const [amount, setAmount] = React.useState<number | null>(setting.amount);
  const [pending, startTransition] = React.useTransition();

  // The bar each automatic option resolves to, through the same function the dashboard uses,
  // so this page and the streak card can't disagree. Goal plans are passed as one stand-in
  // goal: only their sum matters here.
  const goals = [{ monthly_plan: goalPlans, archived: 0 }];
  const resolve = (m: CommitmentMode) => commitment(recurring, goals, { mode: m, amount });
  const auto = resolve("auto");

  const options: { mode: CommitmentMode; label: string; detail: React.ReactNode }[] = [
    {
      mode: "auto",
      label: "Automatic",
      detail: auto.bar > 0 ? (
        <>
          <Amt>{fmtVND(auto.bar)}</Amt>/month now, from your{" "}
          {auto.barSource === "recurring" ? "recurring rules" : "goals' monthly plans"}. Your
          recurring rules, or your goals&apos; plans when you have no rules.
        </>
      ) : (
        "Your recurring rules, or your goals' plans when you have no rules. Neither is set yet."
      ),
    },
    {
      mode: "recurring",
      label: "Recurring rules",
      detail: recurring > 0
        ? <><Amt>{fmtVND(recurring)}</Amt>/month across your active rules.</>
        : <>No active rules — <Link href="/recurring" className="underline hover:text-foreground">add one</Link>.</>,
    },
    {
      mode: "goals",
      label: "Goal plans",
      detail: goalPlans > 0
        ? <><Amt>{fmtVND(goalPlans)}</Amt>/month across your goals&apos; monthly plans.</>
        : <>No goal has a monthly plan — <Link href="/goals" className="underline hover:text-foreground">set one</Link>.</>,
    },
    {
      mode: "custom",
      label: "A fixed amount",
      detail: "A monthly figure you choose, whatever your rules and goals say.",
    },
  ];

  const save = () =>
    startTransition(async () => {
      const res = await saveStreakCommitment({ mode, amount });
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    });

  return (
    <div className="card-surface panel-body">
      <div className="text-body-lg font-semibold tracking-[-0.01em]">Monthly commitment</div>
      <div className="mt-1 max-w-[760px] text-body-sm text-muted-foreground">
        The bar each month of your streak is measured against: what you bought into investments
        plus new deposit principal has to reach it. Changing it re-judges past months too —
        the streak is worked out from your records each time, never stored.
      </div>

      <div role="radiogroup" aria-label="Commitment source" className="mt-5 grid max-w-[620px] gap-2">
        {options.map((o) => {
          const on = mode === o.mode;
          return (
            <button
              key={o.mode}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setMode(o.mode)}
              className={cn(
                "flex items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors",
                on ? "border-foreground bg-pane-sunk" : "border-divider hover:border-foreground/50",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
                  on ? "border-foreground" : "border-field-border",
                )}
              >
                {on && <span className="size-2 rounded-full bg-foreground" />}
              </span>
              <span className="min-w-0">
                <span className="block text-body-sm font-semibold">{o.label}</span>
                <span className="mt-0.5 block text-caption text-muted-foreground">{o.detail}</span>
              </span>
            </button>
          );
        })}
      </div>

      {mode === "custom" && (
        <div className="mt-4 grid max-w-[320px] gap-2">
          <Label htmlFor="streak-amount">Amount per month (VND)</Label>
          <CurrencyInput
            id="streak-amount"
            name="amount"
            defaultValue={amount ?? undefined}
            placeholder="20.000.000"
            onValueChange={setAmount}
          />
        </div>
      )}

      {mode !== "custom" && mode !== "auto" && resolve(mode).bar === 0 && (
        <p className="mt-3 max-w-[620px] text-caption text-muted-foreground">
          This source comes to nothing right now, so the streak will show its empty state until
          it does.
        </p>
      )}

      <div className="mt-4">
        <Button type="button" size="sm" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
