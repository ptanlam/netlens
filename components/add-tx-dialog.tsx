"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { addTx } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TxForm } from "@/components/tx-form";

export function AddTxDialog({ instruments }: { instruments: string[] }) {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-3.5" />
        Add transaction
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add transaction</DialogTitle>
          <DialogDescription>
            Record a buy or sell. Amounts are whole VND; quantity can be confirmed
            later for fund purchases.
          </DialogDescription>
        </DialogHeader>
        <TxForm
          action={addTx}
          instruments={instruments}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
