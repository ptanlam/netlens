<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Agent guide

Personal net-worth tracker: **investments, savings (term deposits), debts (loans + credit cards)**, with a dashboard. Read this first, then the deep docs in [`docs/`](docs/).

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the app is wired (data → actions → pages).
- [`docs/ADDING_A_FEATURE.md`](docs/ADDING_A_FEATURE.md) — copy-paste recipe for a new tracked entity (savings/debts are the templates).
- [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) — money, formatting, UI, and lint gotchas.
- [`docs/WORKFLOW.md`](docs/WORKFLOW.md) — run, verify, and visually test (headless Chrome).

## ⚠️ Read before touching anything

1. **This is the right app.** There are TWO similarly-named apps on this machine:
   - ✅ **This one** — Next.js 16, at the repo root (`.../_personal/investment-visualization`), port **3000**. Edit here.
   - ❌ Legacy **Flask** app at `~/Projects/personal/investment-visualization` (note: `personal`, no underscore), port **8000**. Do NOT edit unless explicitly asked.
2. **A Docker container often holds port 3000** (an old build). `npm run dev` then falls back to **3001** and prints the URL — always test against the port it prints. To update the container: `docker compose up -d --build`.
3. **`data/investments.db` is real financial data** (git-ignored, SQLite/WAL). If you insert test rows to verify, delete them afterward. Prefer a throwaway DB: `DB_PATH=/tmp/test.db npm run dev`.

## Stack

Next.js 16 (App Router, Server Actions, Turbopack) · React 19 · **@base-ui/react** primitives wrapped in `components/ui/` (shadcn-style) · Tailwind CSS v4 · Recharts · better-sqlite3 · sonner (toasts) · next-themes.

## Architecture in 6 lines

- **`lib/db.ts`** — better-sqlite3, the single source of truth. `SCHEMA` string uses `CREATE TABLE IF NOT EXISTS` (adding a table auto-migrates). Pure CRUD functions.
- **`lib/types.ts`** — shared types/consts, safe to import from client components (no Node deps).
- **`lib/*.ts`** — pure logic: `savings.ts` (interest maths for savings AND debts), `pnl.ts`, `prices.ts`, `format.ts`.
- **`app/actions.ts`** — all `"use server"` mutations; each calls `revalidateAll()` after writing.
- **`app/**/page.tsx`** — server components: read from `lib/db`, render a `<Card>` + a client manager component.
- **`components/*-manager.tsx`, `*-form.tsx`** — `"use client"`; call server actions, toast, and use `<Dialog>` for add/edit.

## The feature pattern (memorize this)

Every tracked entity (transactions, holdings, recurring, **savings**, **debts**) is the same shape:

> table in `SCHEMA` → CRUD in `lib/db.ts` → type in `lib/types.ts` → actions in `app/actions.ts` (+ add route to `revalidateAll`) → `components/<x>-manager.tsx` → `app/<x>/page.tsx` → link in `components/nav.tsx` `LINKS` (drives desktop nav AND the mobile drawer).

`savings` and `debts` are near-identical templates — copy one. See `docs/ADDING_A_FEATURE.md`.

## Must-know gotchas

- **`searchParams` and `params` are Promises** in page props — `await` them (e.g. `app/transactions/page.tsx` pagination).
- **Base UI `<Button render={<Link/>}>`** needs `nativeButton={false}` or it warns.
- **React Compiler lint (`react-hooks/immutability`)** forbids reassigning a captured variable inside a `.map()` in `useMemo` (e.g. `sum += x`). Use prefix sums / `reduce` instead.
- **Money is whole-VND integers** (signed: + in, − out). Format with `fmtVND` / `fmtTr` from `lib/format.ts`. Never hardcode currency.
- **Verify every change**: `npx tsc --noEmit` + `npm run lint`, then a headless-Chrome screenshot for UI. Both must be clean. Details in `docs/WORKFLOW.md`.

## Money & interest

`lib/savings.ts` holds the shared interest maths over an `Accruing` shape (`{principal, rate, start_date, term_months, interest_type}`). Savings deposits and debts both use `currentValue` / `maturityValue` / `summarize` / `isMatured`. A debt with `term_months <= 0` is **revolving** (credit card): open-ended, never matures. The dashboard **Net worth = investments + savings + fund cash − debts** (`components/net-worth.tsx`).

## Goals & sinking funds

A goal is a target on a metric (`lib/goals.ts`, `GOAL_METRICS`). Four metrics are figures the app already computes; **`fund`** is a sinking fund (a car, a wedding) and is the only one that stores state:

- **Cash** you set aside lives in `goal_contributions` (a ledger — negative rows are withdrawals). It earns nothing.
- **Interest** comes from earmarking real deposits: `savings.goal_id` ties a deposit to a fund, and each keeps its own rate and term. There's deliberately no fund-wide rate — you take whatever rate was on offer the month you had the money.
- **Counted once.** An earmarked deposit stays in the Savings line of net worth; only the un-deposited cash is the extra "Set aside" line. `db.fundsCashTotal()` is cash-only for exactly this reason.
- **A net-worth goal excludes everything earmarked** (`earmarkedAt` in `lib/goals.ts`): the money is yours, but it's spoken for, so it can't count toward a number you mean to keep.
- **"Mark as bought"** drains the cash and *un-earmarks* the deposits — it never deletes them. The bank still holds a deposit until you break it; delete it on the Savings page then.

