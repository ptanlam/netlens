"use client";

import * as React from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Tx } from "@/lib/types";
import { deleteTx, updateTx } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TxForm } from "@/components/tx-form";

export function TxRowActions({ tx, instruments }: { tx: Tx; instruments: string[] }) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  return (
    <div className="flex justify-end gap-1">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label="Edit transaction" />}
        >
          <Pencil className="size-3.5" />
        </DialogTrigger>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit transaction</DialogTitle>
            <DialogDescription>
              {tx.date} · {tx.instrument}
            </DialogDescription>
          </DialogHeader>
          <TxForm
            action={(fd) => updateTx(tx.id, fd)}
            instruments={instruments}
            tx={tx}
            submitLabel="Update transaction"
            onDone={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Delete transaction"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Delete ${tx.date} ${tx.instrument} (${tx.amount.toLocaleString()} VND)?`))
            return;
          startTransition(async () => {
            const res = await deleteTx(tx.id);
            if (res.ok) toast.success(res.message);
            else toast.error(res.message);
          });
        }}
      >
        <Trash2 className="size-3.5 text-destructive" />
      </Button>
    </div>
  );
}
