"use client";

import * as React from "react";
import { Repeat } from "lucide-react";
import { addRule } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { RuleForm } from "@/components/recurring-manager";
import { type InstrumentOption } from "@/components/tx-form";

/** Top-level "Add recurring" — pick any holding + schedule in one dialog. */
export function AddRecurringDialog({ instruments }: { instruments: InstrumentOption[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Repeat className="size-3.5" />
        Add recurring
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add recurring rule</DialogTitle>
          <DialogDescription>
            Auto-invest a fixed amount into a holding on a schedule. Due purchases are
            created automatically, and missed dates are backfilled.
          </DialogDescription>
        </DialogHeader>
        <RuleForm action={addRule} instruments={instruments} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
