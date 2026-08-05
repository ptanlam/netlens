"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { toast } from "sonner";
import { rebuildPnlHistory } from "@/app/actions";
import { cn } from "@/lib/utils";

/**
 * Refetches the daily closes the P&L chart is reconstructed from.
 *
 * Lives in Settings → Price sources: it drives every configured feed's history fetcher, and
 * a full backfill is a maintenance job, not something to keep within one click of the chart.
 *
 * `onDone` is for a caller holding the series in client state — `/api/pnl-history` is
 * fetched after mount, so the action's `revalidatePath` refreshes the server tree but can't
 * touch it. Nothing needs that from here; the dashboard re-pulls on its next mount.
 */
export function RebuildHistoryButton({ onDone }: { onDone?: () => void }) {
  const [pending, setPending] = React.useState(false);
  const inFlight = React.useRef(false);
  const [, startTransition] = React.useTransition();
  const router = useRouter();

  const run = async () => {
    if (inFlight.current) return; // full-range fetches are slow; never stack them
    inFlight.current = true;
    setPending(true);
    try {
      // Awaited outside the transition for the same reason as the price refresh: React
      // holds a transition open for as long as its callback runs, and this one can take
      // tens of seconds — long enough to make every nav click look frozen.
      const res = await rebuildPnlHistory();
      onDone?.();
      startTransition(() => {
        router.refresh();
      });
      if (res.ok) toast.success(res.message);
      else {
        console.error(
          `[rebuild-history] ${res.message}` +
            (res.errors.length ? `\n  - ${res.errors.join("\n  - ")}` : ""),
        );
        toast.warning(res.message);
      }
    } catch (e) {
      toast.error(`Rebuild failed: ${(e as Error).message}`);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={pending}
      title="Refetch every holding's daily price history"
      className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-input bg-transparent px-3 text-[12px] font-semibold text-muted-foreground transition-colors hover:border-brand hover:text-brand disabled:cursor-default disabled:opacity-60"
    >
      <History className={cn("size-3.5", pending && "animate-spin")} />
      {pending ? "Rebuilding…" : "Rebuild history"}
    </button>
  );
}
