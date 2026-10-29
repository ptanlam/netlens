"use client";

import * as React from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { searchSymbols } from "@/app/actions";
import {
  MANUAL_SOURCE, SYMBOL_HELP, SYMBOL_HELP_DEFAULT, type SymbolHit,
} from "@/lib/types";

/** How long typing must pause before a search goes out — each one is an upstream request. */
const DEBOUNCE_MS = 300;
/** How close to the bottom of the list (px) scrolling fetches the next page. */
const LOAD_MORE_PX = 48;

interface Results {
  /** The source and query these are for: results for anything else are stale. */
  source: string;
  query: string;
  page: number;
  items: SymbolHit[];
  hasMore: boolean;
  searchable: boolean;
  error?: string;
}

/**
 * The holding form's Symbol field: free text, with suggestions looked up in the feed the
 * holding will be priced from (`searchSymbols`). Whatever is in the box is what's saved —
 * picking a suggestion only fills it in — so a symbol the search can't find can still be
 * typed. Searches wait for a pause in typing, and scrolling to the end of the list loads
 * the next page.
 */
export function SymbolAutocomplete({
  id,
  name,
  source,
  defaultValue,
}: {
  id: string;
  name: string;
  /** The price source key chosen in the form. */
  source: string;
  defaultValue?: string;
}) {
  const [value, setValue] = React.useState(defaultValue ?? "");
  const [results, setResults] = React.useState<Results | null>(null);
  const [loading, setLoading] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Every request takes a ticket; only the latest one's answer is kept, so a slow reply to
  // an old query can't overwrite the results for what's in the box now.
  const ticket = React.useRef(0);

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const manual = source === MANUAL_SOURCE;
  // Results belong to the source they were fetched from; switching source drops them.
  const current = results?.source === source ? results : null;

  const load = (query: string, page: number) => {
    const mine = ++ticket.current;
    setLoading(true);
    searchSymbols(source, query, page)
      .then((r) => {
        if (mine !== ticket.current) return;
        setResults((prev) => ({
          source,
          query,
          page,
          items: page > 0 && prev ? [...prev.items, ...r.items] : r.items,
          hasMore: r.hasMore,
          searchable: r.searchable,
          error: r.error,
        }));
      })
      .catch((e: unknown) => {
        if (mine === ticket.current)
          setResults({ source, query, page, items: [], hasMore: false, searchable: true, error: String(e) });
      })
      .finally(() => {
        if (mine === ticket.current) setLoading(false);
      });
  };

  const search = (query: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => load(query.trim(), 0), DEBOUNCE_MS);
  };

  const status = (() => {
    if (!current?.searchable) return loading ? "Searching…" : null;
    if (loading && current.page === 0) return "Searching…";
    if (current.error) return `Couldn't search: ${current.error}. You can still type the symbol.`;
    if (current.items.length === 0)
      return current.query ? `No match for "${current.query}" — it's saved as typed.` : "Type a name or ticker to search.";
    return null;
  })();
  const showPopup = !manual && (status != null || (current?.items.length ?? 0) > 0);

  return (
    <div className="grid gap-1.5">
      <Autocomplete.Root
        name={name}
        items={current?.items ?? []}
        value={value}
        filter={null}
        openOnInputClick
        itemToStringValue={(hit: SymbolHit) => hit.symbol}
        onValueChange={(next, details) => {
          setValue(next);
          if (!manual && (details.reason === "input-change" || details.reason === "input-clear")) search(next);
        }}
        onOpenChange={(open) => {
          // First open for this source: show what the feed has for what's already typed.
          if (open && !manual && !current && !loading) load(value.trim(), 0);
        }}
      >
        <Autocomplete.Input
          id={id}
          autoComplete="off"
          placeholder={manual ? "Optional label" : "Search the feed, or type a symbol"}
          className="h-10 w-full min-w-0 rounded-lg border border-field-border bg-card px-3.5 py-1 text-field outline-none placeholder:text-faint hover:border-foreground focus-visible:border-foreground focus-visible:ring-1 focus-visible:ring-foreground"
        />
        <Autocomplete.Portal hidden={!showPopup}>
          <Autocomplete.Positioner className="isolate z-50 outline-hidden" sideOffset={4} align="start">
            <Autocomplete.Popup
              className="w-(--anchor-width) max-w-(--available-width) rounded-xl floating-menu text-popover-foreground"
              aria-busy={loading || undefined}
            >
              <div
                className="max-h-[min(var(--available-height),18rem)] overflow-y-auto overscroll-contain p-1"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  if (current?.hasMore && !loading && el.scrollTop + el.clientHeight >= el.scrollHeight - LOAD_MORE_PX)
                    load(current.query, current.page + 1);
                }}
              >
                <Autocomplete.Status>
                  {status && <div className="px-2.5 py-2 text-body-sm text-muted-foreground">{status}</div>}
                </Autocomplete.Status>
                <Autocomplete.List>
                  {(hit: SymbolHit) => (
                    <Autocomplete.Item
                      key={hit.symbol}
                      value={hit}
                      className="flex cursor-pointer flex-col gap-0.5 rounded-lg px-2.5 py-2 text-body-sm outline-hidden select-none data-highlighted:bg-pane"
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-semibold">{hit.label ?? hit.symbol}</span>
                        {hit.detail && (
                          <span className="shrink-0 font-mono text-caption tabular-nums text-muted-foreground">
                            {hit.detail}
                          </span>
                        )}
                      </span>
                      {hit.label && <span className="font-mono text-caption text-muted-foreground">{hit.symbol}</span>}
                    </Autocomplete.Item>
                  )}
                </Autocomplete.List>
                {loading && current?.hasMore && (
                  <div className="px-2.5 py-2 text-caption text-muted-foreground">Loading more…</div>
                )}
              </div>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>
      <p className="text-caption text-muted-foreground">{SYMBOL_HELP[source] ?? SYMBOL_HELP_DEFAULT}</p>
    </div>
  );
}
