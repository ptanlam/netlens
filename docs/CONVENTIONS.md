# Conventions & gotchas

## Money
- Stored as **whole-VND integers**. Transaction amounts are **signed**: `+` = money in
  (buy/contribute), `−` = money out (sell/withdraw).
- Format for display with `lib/format.ts`:
  - `fmtVND(1234567)` → `₫1.234.567` (de-DE style `.` thousands; handles negatives).
  - `fmtTr(40_000_000)` → `40tr` (chart axis short form; `tr` = triệu = million).
- Round on write (`Math.round`) so the DB never stores fractional VND.

## Dates
- ISO `YYYY-MM-DD` strings everywhere. Local "today": `new Date().toLocaleDateString("sv-SE")`.
- Server-side default: `db.todayIso()`.
- Month keys are `date.slice(0,7)`; comparisons use plain string `<=`/`>=` (ISO sorts lexically).

## UI stack & components
- Reuse `components/ui/*` (Button, Card, Dialog, Select, Input, Label, Checkbox,
  Table, Badge, Separator, Chart, Sonner). These wrap **@base-ui/react** — do not pull
  in Radix or other primitive libs.
- **All data tables use TanStack Table** (`@tanstack/react-table`) via the shared
  `components/data-table.tsx` (`<DataTable columns={} data={} />`; supports sortable
  headers, optional client `pageSize`, and per-column `meta.align`). See
  `debts-manager.tsx` / `transactions-table.tsx` for column-def examples; even the
  editable holdings form renders through it (sorting disabled, input names keyed by a
  stable row index). Do not hand-roll `<table>` markup.
- Charts: **Recharts** via the `ChartContainer`/`ChartTooltip` wrappers in
  `components/ui/chart.tsx`. Set `isAnimationActive={false}` (matches existing charts).
- Toasts: `sonner` (`toast.success` / `toast.error`), configured in `app/layout.tsx`.
- Theme: `next-themes`, `class` attribute, system default. Picked on
  `/settings/appearance` (`components/appearance-settings.tsx`) — Match system / Daylight
  (light) / Midnight (dark). Colors come from CSS vars in `app/globals.css`.
- Every panel is `card-surface` — a custom utility in `app/globals.css` carrying the
  radius, hairline border and lift. Don't re-spell it as `rounded-xl border bg-card`, or
  the card ends up flat while everything around it is raised.
- Typography is two families: **Space Grotesk** (`font-sans`, and `font-heading`/
  `font-serif` alias to it) and **JetBrains Mono** (`font-mono`) for every figure.
  Section headings are `text-[NNpx] font-bold`; micro-labels are sans
  `text-[10.5px] font-semibold tracking-[0.14em] uppercase text-faint`, never mono.

## Colors
- **Never hardcode a color.** Every colour must resolve to a CSS var from
  `app/globals.css`, because each one has a `.dark` counterpart — a raw hex silently
  breaks dark mode. Use the semantic tokens: `text-faint`, `border-divider(-soft)`,
  `bg-warning(-bg)`, `bg-positive-wash` / `bg-negative-wash`, `text-*-strong`,
  `--grid` / `--grid-strong` (chart gridlines), `--chart-ink` / `--chart-gold` (lines).
  For computed alphas (area fills, tinted calendar cells) use the bare RGB triples:
  `rgb(var(--positive-rgb) / 0.13)`.
- The chart tooltip is `bg-foreground`, so its surface **inverts** with the theme. Its
  text uses `--tooltip-positive/negative/neutral`, which flip in `.dark` to stay legible.
- Asset types have fixed slots: `TYPE_COLORS` in `dashboard-charts.tsx`
  (Funds=chart-1, Stocks=chart-2, Crypto=chart-3, Real Estate=chart-4). Color follows
  the entity, never its rank.
- `--brand` (violet) is the **action** colour — primary buttons, the active nav pill, the
  value line on charts. Gains stay `--accent-brand` green. Don't reach for green to mean
  "primary", or a neutral control starts reading as a profit.
- Gains/losses: `text-(--chart-positive)` / `text-(--chart-negative)` (Tailwind v4
  arbitrary-property syntax). Debts/owed amounts render negative-colored.

## Responsive / mobile
- The app is used on a phone. Verify at 390px wide.
- Long currency values clip in 2–3 column card grids — use responsive sizes like
  `text-lg sm:text-2xl lg:text-3xl` + `tabular-nums`, not a fixed `text-3xl`.
- Summary card rows: stack on mobile, one row on desktop (`grid-cols-1 sm:grid-cols-3`).
- Nav is a horizontal bar on desktop and a hamburger **side-drawer** on mobile
  (`components/nav.tsx`). Both are driven by the single `LINKS` array.

## Next.js 16 specifics (this is not older Next)
- `params` and `searchParams` in page props are **Promises** — `await` them.
- Server Components by default; add `"use client"` only where you need state/effects.
- Server Actions live in `app/actions.ts` (`"use server"`); a client form can call them
  directly via `<form action={…}>` or by importing the function.
- When unsure about an API, read `node_modules/next/dist/docs/`.

## TypeScript / React Compiler lint
- `npm run lint` runs ESLint incl. `react-hooks/*`. The **immutability** rule forbids
  mutating a captured variable after render — e.g. `let s=0; xs.map(x => s+=x)` inside a
  `useMemo`. Use `reduce`, or `xs.map((_,i)=> xs.slice(0,i+1).reduce(...))`.
- Prefer discriminated unions (`{ok:true,value} | {ok:false,message}`) over
  `{ error?: … }` — the latter widens `message` to `string | undefined` and breaks
  action prop types.

## Data safety
- `data/investments.db` is **real, git-ignored financial data**. Don't commit it.
- If you must exercise a mutation to verify, insert then **delete** the test row, or run
  the dev server against a scratch DB: `DB_PATH=/tmp/test.db npm run dev`.
- "Export CSV" (`/export.csv`) is the user's backup path.
