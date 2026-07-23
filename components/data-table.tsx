"use client";

import * as React from "react";
import {
  type Column,
  type ColumnDef,
  type ColumnOrderState,
  type ColumnPinningState,
  type ColumnSizingState,
  type PaginationState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Menu } from "@base-ui/react/menu";
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  ArrowUpDown,
  ArrowUpZA,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  EllipsisVertical,
  PinOff,
  PinIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Align = "left" | "right";

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100];

const MENU_POPUP =
  "z-50 min-w-40 origin-(--transform-origin) rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none " +
  "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";

const MENU_ITEM =
  "relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none " +
  "focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:text-muted-foreground";

/** Sticky offsets + edge shadow for a pinned column, keyed off TanStack's measured sizes. */
function pinStyles<TData>(column: Column<TData>): React.CSSProperties {
  const pinned = column.getIsPinned();
  if (!pinned) return {};
  return {
    position: "sticky",
    left: pinned === "left" ? column.getStart("left") : undefined,
    right: pinned === "right" ? column.getAfter("right") : undefined,
    zIndex: 2,
  };
}

/** Move `dragged` to sit where `target` is, working off the table's live column order. */
function reorder(order: string[], dragged: string, target: string): string[] {
  const next = [...order];
  const from = next.indexOf(dragged);
  const to = next.indexOf(target);
  if (from === -1 || to === -1) return order;
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

// useLayoutEffect on the client (no paint flicker for the FLIP), useEffect on the server
// (which never runs it) — sidesteps React's "useLayoutEffect does nothing on the server".
const useIsoLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

const STORAGE_PREFIX = "netlens:table:";

/** State we round-trip through localStorage. pageIndex is deliberately left out — a
 *  reload should land on the first page, not wherever you last paged to. */
type PersistedState = {
  sorting?: SortingState;
  columnOrder?: ColumnOrderState;
  columnPinning?: ColumnPinningState;
  columnSizing?: ColumnSizingState;
  pageSize?: number;
};

/** Keep a saved order usable after the columns change in code: drop ids that no longer
 *  exist, then append any new columns so nothing silently disappears. */
function sanitizeOrder(stored: string[], ids: string[]): string[] {
  const kept = stored.filter((id) => ids.includes(id));
  const missing = ids.filter((id) => !kept.includes(id));
  return [...kept, ...missing];
}

/**
 * Shared TanStack-powered table. Sortable headers, plus per-column pinning, resizing,
 * and drag-to-reorder from each header's menu / grip. Only the table body scrolls
 * horizontally — pagination controls live outside the scroll region. Pass `pageSize`
 * to paginate (with a page-size picker and first/last jumps).
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  initialSorting = [],
  pageSize,
  emptyMessage = "Nothing here yet.",
  storageKey,
}: {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  initialSorting?: SortingState;
  pageSize?: number;
  emptyMessage?: string;
  /** When set, sorting / order / pinning / sizing / page size persist to localStorage. */
  storageKey?: string;
}) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const [columnOrder, setColumnOrder] = React.useState<ColumnOrderState>([]);
  const [columnPinning, setColumnPinning] = React.useState<ColumnPinningState>({});
  const [columnSizing, setColumnSizing] = React.useState<ColumnSizingState>({});
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: pageSize ?? 10,
  });
  // False until the saved state has been read; gates saving so the initial default
  // render can't overwrite what's in storage before we've loaded it.
  const [hydrated, setHydrated] = React.useState(false);

  const columnIds = React.useMemo(
    () =>
      columns
        .map((c) => {
          const col = c as { id?: string; accessorKey?: string };
          return col.id ?? col.accessorKey ?? "";
        })
        .filter(Boolean),
    [columns],
  );

  // Load once, after mount — never during the SSR/first render, so hydration matches.
  React.useEffect(() => {
    if (!storageKey) {
      setHydrated(true);
      return;
    }
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + storageKey);
      if (raw) {
        const s = JSON.parse(raw) as PersistedState;
        if (s.sorting) setSorting(s.sorting);
        if (Array.isArray(s.columnOrder)) setColumnOrder(sanitizeOrder(s.columnOrder, columnIds));
        if (s.columnPinning) setColumnPinning(s.columnPinning);
        if (s.columnSizing) setColumnSizing(s.columnSizing);
        if (typeof s.pageSize === "number") setPagination((p) => ({ ...p, pageSize: s.pageSize! }));
      }
    } catch {
      // Corrupt or unavailable storage — fall back to defaults.
    }
    setHydrated(true);
    // Load is intentionally keyed on storageKey alone; columnIds only sanitizes the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Persist on change. pageIndex is excluded from the deps so paging doesn't spam writes.
  React.useEffect(() => {
    if (!hydrated || !storageKey) return;
    try {
      const payload: PersistedState = {
        sorting,
        columnOrder,
        columnPinning,
        columnSizing,
        pageSize: pagination.pageSize,
      };
      localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(payload));
    } catch {
      // Storage full or unavailable — persistence is best-effort.
    }
  }, [hydrated, storageKey, sorting, columnOrder, columnPinning, columnSizing, pagination.pageSize]);

  // TanStack Table's useReactTable returns non-memoizable functions by design.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnOrder, columnPinning, columnSizing, pagination },
    onSortingChange: setSorting,
    onColumnOrderChange: setColumnOrder,
    onColumnPinningChange: setColumnPinning,
    onColumnSizingChange: setColumnSizing,
    onPaginationChange: setPagination,
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    defaultColumn: { minSize: 56, size: 150 },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(pageSize ? { getPaginationRowModel: getPaginationRowModel() } : {}),
  });

  const rows = table.getRowModel().rows;

  const containerRef = React.useRef<HTMLDivElement>(null);
  // Column left-edges captured the instant before a reorder, so the FLIP effect can slide
  // each column from where it was to where it lands.
  const flipRects = React.useRef<Map<string, number>>(new Map());
  // Live-drag bookkeeping. Refs (not state) so drag handlers read them synchronously; the
  // id is mirrored into state only to drive the dragged column's dimmed styling.
  const draggingRef = React.useRef<string | null>(null);
  const lastOverRef = React.useRef<string | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);

  const captureColumnRects = () => {
    const map = new Map<string, number>();
    containerRef.current
      ?.querySelectorAll<HTMLElement>("thead th[data-col-id]")
      .forEach((th) => map.set(th.dataset.colId!, th.getBoundingClientRect().left));
    flipRects.current = map;
  };

  const startDrag = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    draggingRef.current = id;
    lastOverRef.current = id;
    setDraggingId(id);
  };

  const endDrag = () => {
    draggingRef.current = null;
    lastOverRef.current = null;
    setDraggingId(null);
  };

  // Reorder live as the pointer crosses into a new column, so the others slide out of the
  // way (via the FLIP effect) while you're still dragging. The lastOver guard keeps a single
  // hover from swapping repeatedly once the columns have shifted under the cursor.
  const dragOverColumn = (e: React.DragEvent, overId: string) => {
    e.preventDefault();
    const dragged = draggingRef.current;
    if (!dragged || overId === lastOverRef.current) return;
    lastOverRef.current = overId;
    if (overId === dragged) return;
    captureColumnRects();
    const base = table.getState().columnOrder.length
      ? table.getState().columnOrder
      : table.getAllLeafColumns().map((c) => c.id);
    setColumnOrder(reorder(base, dragged, overId));
  };

  // FLIP: after the order changes, translate every cell from its old column position to the
  // new one, then release it to 0 with a transition so the columns visibly slide into place.
  useIsoLayoutEffect(() => {
    const prev = flipRects.current;
    const root = containerRef.current;
    if (!prev.size || !root) return;
    flipRects.current = new Map();

    const newLeft = new Map<string, number>();
    root
      .querySelectorAll<HTMLElement>("thead th[data-col-id]")
      .forEach((th) => newLeft.set(th.dataset.colId!, th.getBoundingClientRect().left));

    const moved: HTMLElement[] = [];
    root.querySelectorAll<HTMLElement>("[data-col-id]").forEach((cell) => {
      if (cell.style.position === "sticky") return; // pinned columns: leave them stuck
      // The dragged column tracks the cursor via the native drag image — don't also slide it.
      if (cell.dataset.colId === draggingRef.current) return;
      const from = prev.get(cell.dataset.colId!);
      const to = newLeft.get(cell.dataset.colId!);
      if (from == null || to == null || from === to) return;
      // Invert: jump each cell back to where its column just was, with no transition.
      cell.style.transition = "none";
      cell.style.transform = `translateX(${from - to}px)`;
      moved.push(cell);
    });
    if (!moved.length) return;

    // Commit the inverted transforms so the transition has a real starting point, then play
    // them back to 0 — the columns slide from their old positions into the new order.
    void root.offsetWidth;
    for (const cell of moved) {
      cell.style.transition = "transform 220ms cubic-bezier(0.2, 0, 0, 1)";
      cell.style.transform = "";
    }
  }, [columnOrder]);

  const sizeOptions = React.useMemo(() => {
    const set = new Set(PAGE_SIZE_OPTIONS);
    if (pageSize) set.add(pageSize);
    return [...set].sort((a, b) => a - b);
  }, [pageSize]);

  return (
    <div ref={containerRef} className="flex flex-col gap-4">
      {/* Fill the container, but never shrink below the columns' total — past that it scrolls.
          Fixed layout stretches the columns proportionally to soak up any extra width. */}
      <Table className="table-fixed" style={{ width: "100%", minWidth: table.getTotalSize() }}>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((header) => {
                const { column } = header;
                const canSort = column.getCanSort();
                const sorted = column.getIsSorted();
                const Icon = !sorted ? ArrowUpDown : sorted === "desc" ? ArrowDown : ArrowUp;
                const align = (column.columnDef.meta as { align?: Align } | undefined)?.align;
                const pinned = column.getIsPinned();
                const label = header.isPlaceholder
                  ? null
                  : flexRender(column.columnDef.header, header.getContext());

                return (
                  <TableHead
                    key={header.id}
                    data-col-id={column.id}
                    style={{ width: header.getSize(), ...pinStyles(column) }}
                    onDragOver={(e) => dragOverColumn(e, column.id)}
                    onDrop={(e) => e.preventDefault()}
                    className={cn(
                      "group/th relative bg-card transition-opacity",
                      draggingId === column.id && "opacity-40",
                      pinned === "left" && column.getIsLastColumn("left") && "shadow-[inset_-1px_0_0_var(--border)]",
                      pinned === "right" && column.getIsFirstColumn("right") && "shadow-[inset_1px_0_0_var(--border)]",
                    )}
                  >
                    <div className={cn("flex items-center gap-1", align === "right" && "flex-row-reverse")}>
                      {/* Drag handle = the label itself; a plain click still sorts. */}
                      <div
                        draggable
                        onDragStart={(e) => startDrag(e, column.id)}
                        onDragEnd={endDrag}
                        className={cn(
                          "flex min-w-0 cursor-grab items-center gap-1 active:cursor-grabbing",
                          align === "right" && "flex-row-reverse",
                        )}
                      >
                        {canSort ? (
                          <button
                            type="button"
                            onClick={column.getToggleSortingHandler()}
                            className={cn(
                              "inline-flex items-center gap-1 truncate hover:text-foreground",
                              align === "right" && "flex-row-reverse",
                            )}
                          >
                            <span className="truncate">{label}</span>
                            <Icon className={cn("size-3.5 shrink-0", !sorted && "opacity-40")} />
                          </button>
                        ) : (
                          <span className="truncate">{label}</span>
                        )}
                      </div>

                      <ColumnMenu column={column} canSort={canSort} align={align} />
                    </div>

                    {column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={() => column.resetSize()}
                        className={cn(
                          "absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none select-none",
                          "opacity-0 transition-opacity hover:opacity-100 group-hover/th:opacity-100",
                          column.getIsResizing() ? "bg-ring opacity-100" : "bg-border",
                        )}
                      />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-20 text-center text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id} className="group/row">
                {row.getVisibleCells().map((cell) => {
                  const { column } = cell;
                  const align = (column.columnDef.meta as { align?: Align } | undefined)?.align;
                  const pinned = column.getIsPinned();
                  return (
                    <TableCell
                      key={cell.id}
                      data-col-id={column.id}
                      style={{ width: column.getSize(), ...pinStyles(column) }}
                      className={cn(
                        "overflow-hidden text-ellipsis transition-opacity",
                        align === "right" && "text-right",
                        draggingId === column.id && "opacity-40",
                        // Pinned cells need an opaque backdrop so scrolled rows don't bleed through.
                        pinned && "bg-card group-hover/row:bg-muted/50",
                        pinned === "left" && column.getIsLastColumn("left") && "shadow-[inset_-1px_0_0_var(--border)]",
                        pinned === "right" && column.getIsFirstColumn("right") && "shadow-[inset_1px_0_0_var(--border)]",
                      )}
                    >
                      {flexRender(column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {pageSize && (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap">Rows per page</span>
            <Select
              value={String(table.getState().pagination.pageSize)}
              onValueChange={(v) => v != null && table.setPageSize(Number(v))}
            >
              <SelectTrigger size="sm" className="w-[4.75rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sizeOptions.map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <span className="tabular-nums">
            Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())} ·{" "}
            {table.getRowCount()} rows
          </span>

          <div className="flex gap-1">
            <Button
              variant="outline" size="icon-sm" aria-label="First page"
              onClick={() => table.firstPage()} disabled={!table.getCanPreviousPage()}
            >
              <ChevronFirst className="size-3.5" />
            </Button>
            <Button
              variant="outline" size="icon-sm" aria-label="Previous page"
              onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              variant="outline" size="icon-sm" aria-label="Next page"
              onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}
            >
              <ChevronRight className="size-3.5" />
            </Button>
            <Button
              variant="outline" size="icon-sm" aria-label="Last page"
              onClick={() => table.lastPage()} disabled={!table.getCanNextPage()}
            >
              <ChevronLast className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Per-column header menu: sort direction + pin left/right/unpin. */
function ColumnMenu<TData>({
  column,
  canSort,
  align,
}: {
  column: Column<TData>;
  canSort: boolean;
  align?: Align;
}) {
  const pinned = column.getIsPinned();
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Column options"
            className={cn(
              "opacity-0 transition-opacity group-hover/th:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100",
              align === "right" ? "-ml-1 mr-auto" : "-mr-1 ml-auto",
            )}
          />
        }
      >
        <EllipsisVertical className="size-3.5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="start" className="isolate z-50">
          <Menu.Popup className={MENU_POPUP}>
            {canSort && (
              <>
                <Menu.Item className={MENU_ITEM} onClick={() => column.toggleSorting(false)}>
                  <ArrowDownAZ /> Sort ascending
                </Menu.Item>
                <Menu.Item className={MENU_ITEM} onClick={() => column.toggleSorting(true)}>
                  <ArrowUpZA /> Sort descending
                </Menu.Item>
                <Menu.Separator className="-mx-1 my-1 h-px bg-border" />
              </>
            )}
            <Menu.Item
              className={MENU_ITEM}
              disabled={pinned === "left"}
              onClick={() => column.pin("left")}
            >
              <PinIcon /> Pin left
            </Menu.Item>
            <Menu.Item
              className={MENU_ITEM}
              disabled={pinned === "right"}
              onClick={() => column.pin("right")}
            >
              <PinIcon className="scale-x-[-1]" /> Pin right
            </Menu.Item>
            {pinned && (
              <Menu.Item className={MENU_ITEM} onClick={() => column.pin(false)}>
                <PinOff /> Unpin
              </Menu.Item>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
