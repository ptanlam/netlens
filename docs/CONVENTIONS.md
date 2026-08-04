# Conventions & gotchas

## Money
- Stored as **whole-VND integers**. Transaction amounts are **signed**: `+` = money in
  (buy/contribute), `−` = money out (sell/withdraw).
- Format for display with `lib/format.ts`:
  - `fmtVND(1234567)` → `₫1.234.567` (de-DE style `.` thousands; handles negatives).
  - `fmtMil(40_000_000)` → `40mil`, `fmtMil(1_200_000_000)` → `1.2bil` (chart axis short
    form). Below a million, axes and compact cells fall back to `k`.
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
- **Surfaces are a three-step stack**, from the "Netlens Alpha" design: the page field
  (`bg-background`) → the panel (`card-surface`) → the in-panel chip (`bg-pane`, e.g. a
  filter control or a table's column bar). Depth is the step plus a hairline `--border`,
  never a blur or a drop shadow — a panel that lifts breaks the only thing holding the
  hierarchy together.
- Every panel is `card-surface` — a custom utility in `app/globals.css` carrying the 18px
  radius, the surface fill and the hairline. Don't re-spell it as `rounded-xl border
  bg-card`, or the radius drifts from every other card on the page. Overlays that set
  their own corners use `panel-surface`; menus use `floating-menu`.
- Every page opens with `<PageHeader title actions>` (`components/page-header.tsx`) — a
  30px title, one line of secondary ink, and the page's actions on the right. Where the
  primary action is a client dialog (`New deposit`, `Add debt`, `New goal`), the *manager*
  renders the header so the two can live in one component.
- **One filled button per view.** `variant="default"` is brand blue with the theme's only
  glow under it; everything else is `outline` (on `bg-pane`) or `ghost`.
- Typography is two families: **Space Grotesk** (`font-sans`, and `font-heading`/
  `font-serif` alias to it) and **JetBrains Mono** (`font-mono`) for every figure. Body
  runs 13.5px/1.45. Page titles are `text-[30px] font-bold tracking-[-0.025em]`, section
  headings a step down at `text-[16-20px] font-bold`, and labels are sentence case at
  reading size — the letterspaced uppercase micro-label survives only on table column
  heads (`table-head-bar` / `<TableHead>`), never on a figure's caption.

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
- `--brand` (blue) is the **action** colour — primary buttons, the brand mark. Gains stay
  `--accent-brand` green. Don't reach for green to mean "primary", or a neutral control
  starts reading as a profit — and don't mark the current nav row in brand either; "here"
  is the `bg-pane` step plus the brighter `--input` hairline.
- The value line on charts is `--chart-ink`, which is gain-green in this design — a value
  series is the one thing that never means "click me". `--chart-gold` (amber) is the
  standalone capital-deployed line; it is deliberately NOT loss-coral, since that chart
  has no green companion to be measured against.
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
- `pnpm lint` runs ESLint incl. `react-hooks/*`. The **immutability** rule forbids
  mutating a captured variable after render — e.g. `let s=0; xs.map(x => s+=x)` inside a
  `useMemo`. Use `reduce`, or `xs.map((_,i)=> xs.slice(0,i+1).reduce(...))`.
- Prefer discriminated unions (`{ok:true,value} | {ok:false,message}`) over
  `{ error?: … }` — the latter widens `message` to `string | undefined` and breaks
  action prop types.

## Data safety
- `data/investments.db` is **real, git-ignored financial data** — now only the source for
  the one-off D1 migration (`docs/CLOUDFLARE.md`). Don't commit it, or `d1-import.sql`.
- If you must exercise a mutation to verify, insert then **delete** the test row, or run
  the dev server against a scratch DB: `DB_PATH=/tmp/test.db pnpm dev`.
- "Export CSV" (`/export.csv`) is the user's backup path.
