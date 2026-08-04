"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import type { SearchItem } from "@/app/api/search-index/route";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const MAX_RESULTS = 7;

/**
 * The design's header search: a bordered field on the panel surface, ⌘K to focus, and a
 * results list that jumps to whatever you pick.
 *
 * The index (holdings, deposits, debts, goals, pages) is fetched once on first focus and
 * kept for the life of the page — see `app/api/search-index/route.ts` for why it isn't a
 * query-per-keystroke. Everything here is a *jump*, never a filter: the search moves you to
 * the page that owns the thing, which is the only promise it can keep across five views
 * that each hold their own state.
 */
export function HeaderSearch() {
  const router = useRouter();
  const [items, setItems] = React.useState<SearchItem[] | null>(null);
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl-K focuses the field from anywhere.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click outside closes the results without clearing what was typed.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const load = React.useCallback(() => {
    if (items) return;
    fetch("/api/search-index")
      .then((r) => (r.ok ? (r.json() as Promise<{ items: SearchItem[] }>) : Promise.reject(new Error())))
      .then((d) => setItems(d.items))
      // A failed index leaves an empty list rather than an error: the field is a shortcut,
      // and every destination in it is one click away in the rail anyway.
      .catch(() => setItems([]));
  }, [items]);

  const results = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !items) return [];
    // Prefix matches first — typing "go" should reach "Goals" before "Emergency fund" even
    // though both contain the letters.
    const hits = items.filter((i) => i.label.toLowerCase().includes(needle));
    return hits
      .slice()
      .sort((a, b) => {
        const ap = a.label.toLowerCase().startsWith(needle) ? 0 : 1;
        const bp = b.label.toLowerCase().startsWith(needle) ? 0 : 1;
        return ap - bp || a.label.localeCompare(b.label);
      })
      .slice(0, MAX_RESULTS);
  }, [q, items]);

  const go = (item: SearchItem) => {
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
    router.push(item.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[Math.min(cursor, results.length - 1)]);
    }
  };

  return (
    // Visibility is CSS's job (`app/globals.css`, `html[data-nav="side"]`), not a class
    // here: the nav preference is stamped before paint, and the top-bar layout has no room
    // for a search field next to its own link pills.
    <div ref={boxRef} data-header-search className="relative min-w-0 flex-1">
      <label className="flex h-[42px] max-w-[420px] items-center gap-2.5 rounded-[13px] border border-border bg-card px-3.5 focus-within:border-input">
        <Search className="size-3.5 shrink-0 text-faint" />
        <input
          ref={inputRef}
          value={q}
          onFocus={() => { load(); setOpen(true); }}
          onChange={(e) => { setQ(e.target.value); setCursor(0); setOpen(true); }}
          onKeyDown={onKeyDown}
          placeholder="Search a holding, goal or transaction…"
          aria-label="Search"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
        />
        <kbd className="shrink-0 rounded-[6px] border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-faint">
          ⌘K
        </kbd>
      </label>

      {open && q.trim() !== "" && (
        <div className="floating-menu absolute top-[calc(100%+6px)] left-0 z-50 w-full max-w-[420px] overflow-hidden rounded-xl border py-1.5">
          {results.length === 0 ? (
            <div className="px-3.5 py-2.5 text-[12.5px] text-muted-foreground">
              {items === null ? "Searching…" : `Nothing matches “${q.trim()}”`}
            </div>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.kind}-${r.label}`}
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(r)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[13px]",
                  i === cursor && "bg-pane",
                )}
              >
                <span className="truncate">{r.label}</span>
                <Badge variant="tag">{r.kind}</Badge>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
