"use client";

import * as React from "react";
import { toast } from "sonner";
import { savePriceSchedule } from "@/app/actions";
import { fetchStatus } from "@/components/live-prices";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DEFAULT_PRICE_SCHEDULE, type PriceRefreshSchedule } from "@/lib/types";

/** Settings → Price refresh: when the server re-quotes prices, as cron lines. The header pill
 *  switches between this and a flat cadence; the lines themselves are only edited here. */
export function PriceScheduleSettings({ schedule }: { schedule: PriceRefreshSchedule }) {
  const [enabled, setEnabled] = React.useState(schedule.enabled);
  const [cron, setCron] = React.useState(schedule.cron);
  const [pending, startTransition] = React.useTransition();

  const save = () =>
    startTransition(async () => {
      const res = await savePriceSchedule({ enabled, cron });
      if (!res.ok) return void toast.error(res.message);
      toast.success(res.message);
      void fetchStatus(); // the header pill follows without waiting for its next poll
    });

  return (
    <div className="card-surface panel-body">
      <div className="text-body-lg font-semibold tracking-[-0.01em]">Refresh schedule</div>
      <div className="mt-1 max-w-[760px] text-body-sm text-muted-foreground">
        When the server re-quotes prices, as cron expressions — one per line, Vietnam time.
        A refresh runs on any minute a line matches. While this is on it replaces the
        interval picked in the header; picking an interval there turns it off.
      </div>

      <label className="mt-5 flex items-center gap-2 text-body-sm font-semibold">
        <Checkbox checked={enabled} onCheckedChange={setEnabled} />
        Refresh on this schedule
      </label>

      <textarea
        aria-label="Cron expressions"
        value={cron}
        onChange={(e) => setCron(e.target.value)}
        rows={4}
        spellCheck={false}
        placeholder={DEFAULT_PRICE_SCHEDULE.cron}
        className="mt-3 w-full max-w-[520px] rounded-lg border border-field-border bg-card px-3.5 py-2 font-mono text-body-sm outline-none placeholder:text-faint hover:border-foreground focus-visible:border-foreground focus-visible:ring-1 focus-visible:ring-foreground"
      />
      <div className="mt-1.5 max-w-[520px] text-caption text-muted-foreground">
        <span className="font-mono">minute hour day month weekday</span> — e.g.{" "}
        <span className="font-mono">*/5 9-14 * * 1-5</span> is every 5 minutes, 09:00–14:55,
        Monday to Friday. Supports <span className="font-mono">* , - /</span>; weekday 0 or 7
        is Sunday. <span className="font-mono">#</span> starts a comment. Nothing finer than a
        minute.
      </div>

      <div className="mt-4 flex gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={save}>
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setCron(DEFAULT_PRICE_SCHEDULE.cron)}>
          Use example
        </Button>
      </div>
    </div>
  );
}
