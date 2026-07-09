"use client";

import * as React from "react";
import { toast } from "sonner";
import { ASSET_TYPES, PRICE_SOURCES, type Instrument } from "@/lib/types";
import { saveHoldings } from "@/app/actions";
import { fmtVND } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export function HoldingsForm({
  rows,
}: {
  rows: { inst: Instrument; value: number }[];
}) {
  const [pending, startTransition] = React.useTransition();

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const res = await saveHoldings(fd);
          if (res.ok) toast.success(res.message);
          else toast.error(res.message);
        })
      }
    >
      <input type="hidden" name="rows" value={rows.length} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Instrument</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Price source</TableHead>
            <TableHead>Symbol</TableHead>
            <TableHead>Quantity</TableHead>
            <TableHead>Manual value (VND)</TableHead>
            <TableHead className="text-right">Last price</TableHead>
            <TableHead className="text-right">Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ inst, value }, i) => (
            <TableRow key={inst.name}>
              <TableCell className="font-medium">
                {inst.name}
                <input type="hidden" name={`inst_${i}`} value={inst.name} />
              </TableCell>
              <TableCell>
                <Select name={`type_${i}`} defaultValue={inst.asset_type}>
                  <SelectTrigger size="sm" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSET_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Select name={`source_${i}`} defaultValue={inst.price_source}>
                  <SelectTrigger size="sm" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRICE_SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Input
                  name={`symbol_${i}`}
                  defaultValue={inst.symbol ?? ""}
                  className="h-8 w-28"
                />
              </TableCell>
              <TableCell>
                <Input
                  name={`qty_${i}`}
                  type="number"
                  step="any"
                  defaultValue={inst.quantity ?? ""}
                  className="h-8 w-28"
                />
              </TableCell>
              <TableCell>
                <Input
                  name={`manual_${i}`}
                  type="number"
                  step="1"
                  defaultValue={inst.manual_value ?? ""}
                  className="h-8 w-36"
                />
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {inst.last_price != null ? inst.last_price.toLocaleString() : "—"}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {value ? fmtVND(value) : "—"}{" "}
                {inst.quantity != null && inst.last_price != null && (
                  <Badge className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">live</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="mt-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save holdings"}
        </Button>
      </div>
    </form>
  );
}
