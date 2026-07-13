"use client";

import * as React from "react";
import { CheckCircle2, Pencil, Plus, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { PriceSource } from "@/lib/types";
import { addPriceSource, deletePriceSource, testPriceSource, updatePriceSource } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type ActionResult = { ok: boolean; message: string };

const FIELD =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** One config field with a label and an optional hint below it. */
function Field({ children, label, htmlFor, hint }: {
  children: React.ReactNode; label: string; htmlFor?: string; hint?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SourceForm({ source, action, submitLabel, onDone }: {
  source?: PriceSource;
  action: (fd: FormData) => Promise<ActionResult>;
  submitLabel: string;
  onDone?: () => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [testing, startTest] = React.useTransition();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [kind, setKind] = React.useState(source?.kind ?? "json");
  const [method, setMethod] = React.useState(source?.method ?? "GET");
  const [batch, setBatch] = React.useState(Boolean(source?.batch));
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);

  const runTest = () => {
    const form = formRef.current;
    if (!form) return;
    setResult(null);
    startTest(async () => setResult(await testPriceSource(new FormData(form))));
  };

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          const res = await action(fd);
          if (res.ok) {
            toast.success(res.message);
            if (!source) formRef.current?.reset();
            onDone?.();
          } else toast.error(res.message);
        })
      }
      className="grid gap-4 sm:grid-cols-2"
    >
      <Field label="Key" htmlFor="ps-key" hint={source ? "The key can't be changed." : "Lowercase id, e.g. binance"}>
        {source ? (
          <div className="flex h-9 items-center rounded-lg border border-input bg-muted/40 px-3 font-mono text-sm text-muted-foreground">
            {source.key}
          </div>
        ) : (
          <Input id="ps-key" name="key" placeholder="binance" required />
        )}
        {source && <input type="hidden" name="key" value={source.key} />}
      </Field>
      <Field label="Label" htmlFor="ps-label" hint="Shown in menus.">
        <Input id="ps-label" name="label" defaultValue={source?.label} placeholder="Binance (crypto → VND)" />
      </Field>

      <Field label="Response kind" hint="How the price is read out.">
        <Select name="kind" value={kind} onValueChange={(v) => v && setKind(v as "json" | "html")}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="json">JSON (dot-path)</SelectItem>
            <SelectItem value="html">HTML (regex)</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="HTTP method">
        <Select name="method" value={method} onValueChange={(v) => v && setMethod(v as "GET" | "POST")}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="GET">GET</SelectItem>
            <SelectItem value="POST">POST</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <div className="sm:col-span-2">
        <Field label="Request URL" htmlFor="ps-url" hint="Templates: {symbol} per holding, {symbols} for a batch request.">
          <Input id="ps-url" name="url" defaultValue={source?.url} placeholder="https://api.example.com/price/{symbol}" required />
        </Field>
      </div>

      {method === "POST" && (
        <div className="sm:col-span-2">
          <Field label="POST body" htmlFor="ps-body" hint="JSON string; supports the same {symbol} / {symbols} templates.">
            <textarea id="ps-body" name="body" defaultValue={source?.body ?? ""} rows={2}
              className={cn(FIELD, "font-mono")} placeholder='{"ids":"{symbols}"}' />
          </Field>
        </div>
      )}

      <label className="flex items-center gap-2 sm:col-span-2 text-sm">
        <input type="checkbox" name="batch" checked={batch} onChange={(e) => setBatch(e.target.checked)} className="size-4" />
        <span>Batch — one request returns prices for many holdings (matched by symbol).</span>
      </label>

      {kind === "json" && batch && (
        <>
          <Field label="Rows path" htmlFor="ps-rows" hint='Dot-path to the array/object of rows. Empty = root.'>
            <Input id="ps-rows" name="rows_path" defaultValue={source?.rows_path ?? ""} placeholder="data.rows" />
          </Field>
          <Field label="Key field" htmlFor="ps-keyfield" hint="Row field matched against a holding's symbol. Blank for object-keyed responses.">
            <Input id="ps-keyfield" name="key_field" defaultValue={source?.key_field ?? ""} placeholder="shortName" />
          </Field>
          <Field label="Price field" htmlFor="ps-pricefield" hint="Field holding the price within each row.">
            <Input id="ps-pricefield" name="price_field" defaultValue={source?.price_field ?? ""} placeholder="nav" />
          </Field>
        </>
      )}

      {kind === "json" && !batch && (
        <div className="sm:col-span-2">
          <Field label="Price path" htmlFor="ps-pricepath" hint="Dot-path to the price in the JSON response.">
            <Input id="ps-pricepath" name="price_path" defaultValue={source?.price_path ?? ""} placeholder="chart.result.0.meta.regularMarketPrice" />
          </Field>
        </div>
      )}

      {kind === "html" && (
        <div className="sm:col-span-2">
          <Field label="Price regex" htmlFor="ps-regex" hint="First capture group is parsed as the price (commas allowed).">
            <Input id="ps-regex" name="price_regex" defaultValue={source?.price_regex ?? ""} placeholder='"price"\s*:\s*"([\d.,]+)"' />
          </Field>
        </div>
      )}

      <Field label="History source" hint="Which built-in fetcher supplies daily history for the P&L chart.">
        <Select name="history_strategy" defaultValue={source?.history_strategy ?? "none"}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="yahoo">Yahoo</SelectItem>
            <SelectItem value="coingecko">CoinGecko</SelectItem>
            <SelectItem value="fmarket">fmarket</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <div className="grid gap-2 rounded-lg border border-dashed p-3 sm:col-span-2">
        <Label htmlFor="ps-test">Test connection</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input id="ps-test" name="test_symbol"
            placeholder={batch ? "symbol to look up (e.g. bitcoin)" : "symbol (e.g. FPT.VN)"}
            className="max-w-xs" />
          <Button type="button" variant="outline" disabled={testing} onClick={runTest}>
            {testing ? "Testing…" : "Test"}
          </Button>
        </div>
        {result && (
          <p className={cn(
            "flex items-start gap-1.5 text-sm",
            result.ok ? "text-green-700 dark:text-green-400" : "text-destructive",
          )}>
            {result.ok
              ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              : <XCircle className="mt-0.5 size-4 shrink-0" />}
            <span className="break-words">{result.message}</span>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Runs the request live and reads the price out — nothing is saved.
        </p>
      </div>

      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
      </div>
    </form>
  );
}

function EditSourceDialog({ source }: { source: PriceSource }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit price source" />}>
        <Pencil className="size-3.5" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {source.label}</DialogTitle>
          <DialogDescription>Adjust how this feed is fetched and parsed.</DialogDescription>
        </DialogHeader>
        <SourceForm source={source} action={(fd) => updatePriceSource(source.key, fd)}
          submitLabel="Update source" onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function DeleteSourceButton({ source }: { source: PriceSource }) {
  const [pending, startTransition] = React.useTransition();
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Delete price source" disabled={pending}
      onClick={() => {
        if (!confirm(`Delete the price source "${source.label}"? This can't be undone.`)) return;
        startTransition(async () => {
          const res = await deletePriceSource(source.key);
          if (res.ok) toast.success(res.message);
          else toast.error(res.message);
        });
      }}>
      <Trash2 className="size-3.5" />
    </Button>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border px-[9px] py-0.5 font-mono text-[10.5px] text-muted-foreground">
      {children}
    </span>
  );
}

export function PriceSourceManager({ sources }: { sources: PriceSource[] }) {
  return (
    <div className="rounded-xl border border-border bg-card px-6 py-6">
      <div className="font-serif text-[22px] font-semibold tracking-[-0.01em]">Price sources</div>
      <div className="mt-1 max-w-[760px] text-[13px] text-muted-foreground">
        The feeds your holdings are priced against. Each is a self-contained config — a request
        URL and how to read the price out — so you can add one without touching code.
      </div>

      <div className="mt-5 flex items-center justify-between border-b border-divider pb-4">
        <span className="text-[13px] text-muted-foreground">
          {sources.length} source{sources.length === 1 ? "" : "s"}. Holdings pick one of these to price against.
        </span>
        <AddSourceDialog />
      </div>

      <div className="mt-[18px] flex flex-col gap-3.5">
        {sources.map((s) => (
          <div key={s.key} className="rounded-[10px] border border-border p-[18px]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <span className="font-serif text-[16px] font-semibold">{s.label}</span>
                <span className="rounded-[5px] bg-foreground px-2 py-0.5 font-mono text-[11px] text-background">{s.key}</span>
                {s.builtin ? (
                  <span className="rounded-[5px] bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground">built-in</span>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <EditSourceDialog source={s} />
                <DeleteSourceButton source={s} />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Tag>{s.kind}</Tag>
              <Tag>{s.method}</Tag>
              {s.batch ? <Tag>batch</Tag> : null}
              <Tag>history: {s.history_strategy}</Tag>
            </div>
            <div className="mt-3 rounded-[7px] border border-divider-soft bg-muted px-3 py-2.5 font-mono text-[12px] break-all text-muted-foreground">
              {s.url}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddSourceDialog() {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-3.5" />
        Add source
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add price source</DialogTitle>
          <DialogDescription>
            Define a feed: a URL, how to read the price out, and (optionally) a history fetcher.
          </DialogDescription>
        </DialogHeader>
        <SourceForm action={addPriceSource} submitLabel="Add source" onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
