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
  `debts-manager.tsx` / `transactions-view.tsx` for column-def examples; even the
  editable holdings form renders through it (sorting disabled, input names keyed by a
  stable row index). Do not hand-roll `<table>` markup.
- Charts: **@tanstack/charts** — a `defineChart({...})` in a `useMemo`, rendered by
  `<Chart definition={} />`. The shared furniture lives in `components/ui/chart.tsx`:
  `CHART_THEME`, `CHART_HOST_STYLE`, `bareAxis()`, and **`CHART_MOTION`** (`svgAnimation:
  CHART_MOTION` — put it on every chart whose numbers can move under a stable set of marks;
  its doc comment says what the tween does and does not cover).
- Toasts: `sonner` (`toast.success` / `toast.error`), configured in `app/layout.tsx`.
- Theme: `next-themes`, `class` attribute, system default. Picked on
  `/settings/appearance` (`components/appearance-settings.tsx`) — Match system / Daylight
  (light) / Midnight (dark). Colors come from CSS vars in `app/globals.css`.
- **The look is the Wise design system**, from the "Netlens Dashboard" design (Claude Design
  project; the brand spec is `DESIGN.md`). Surfaces are a three-step stack: the sage page
  (`bg-background`) → the white card (`card-surface`) → sage again for an in-panel chip
  (`bg-pane`, e.g. a segmented control or a table's column bar). Wise is **flat**: depth is
  that colour step alone, with no border and no shadow on a card. Only floating layers
  (menus, dialogs, toasts) get a shadow.
- Every panel is `card-surface` — a custom utility in `app/globals.css` carrying Wise's 24px
  radius and the card fill. Don't re-spell it as `rounded-2xl bg-card`. Overlays that set
  their own corners use `panel-surface`; menus use `floating-menu`.
- The net-worth hero is the page's **one inverse surface**: `bg-hero` (ink, with the figure in
  Wise Green; it flips to a green card with ink figures in dark mode). Use the `hero-*` tokens
  inside it, since the normal ink tokens don't read on it.
- Every page opens with `<PageHeader title actions>` (`components/page-header.tsx`) — a
  40px display-face (Figtree 900) title, one line of secondary ink, and the page's actions on the right. Where the
  primary action is a client dialog (`New deposit`, `Add debt`, `New goal`), the *manager*
  renders the header so the two can live in one component.
- **One filled button per view.** Every button is a pill. `variant="default"` is Wise Green
  with a forest-ink label; everything else is `outline` (white with a 1px ink edge),
  `secondary` (sage) or `ghost`. Form fields have a 12px corner and a `border-field-border`
  edge that goes to full ink on focus.
- **Row marks are `<EntityAvatar name color logo>`** (`components/entity-avatar.tsx`).
  With a `logo` it's the real brand mark on a white chip; without one it falls back to
  the tinted first letter. Holdings resolve theirs through `holdingLogo(name, symbol)`
  (`lib/logos.ts`) — a lookup over PNGs bundled in `public/logos/`, deliberately not
  hotlinked (the issuers' own files are 100 KB–3 MB press assets). To add one: crop the
  issuer's logo down to its *symbol* — a wordmark is an unreadable smudge at 24px —
  trim the margin, letterbox it into a 96px transparent square, and add the line to
  `LOGOS`. An unknown holding keeps the letter, so a missing logo is never a bug.
- Every "over time" panel takes its window from `<DateRange from to min max onChange>`
  (`components/date-range.tsx`) — 1M/3M/YTD/All plus the two dates spelled out. `max` is the
  anchor the presets count back from, so pass the newest point you actually hold, not today.
  Three panels had hand-rolled this and the copies had already drifted.
- **Chips are `<Badge>`, and the variant is a matter of meaning, not taste.** `variant="tag"`
  is a *kind* — "Funds", "Credit", "Sinking fund", an asset type. It's the 7px corner on
  `bg-pane` in muted ink, and it never signals good or bad. Every other variant is a
  *state* — Active, live, Behind, Due — and is a full pill tinted by tone (`accent`,
  `warning`, `destructive`, `secondary`). Don't hand-roll `rounded-sm bg-secondary px-[7px]`;
  four components each grew their own before this was one component.
- Typography is two families: **Inter** (`font-sans`; `font-heading`/`font-serif` alias to
  it, with the `opsz` axis so large text takes the Display cut) for everything, and
  **Figtree 900** (`font-display`) standing in for Wise's proprietary Wise Sans on the brand
  moments only: page titles, the wordmark and the net-worth figure. Figtree has no ₫, which
  falls through to Inter 900. Figures keep the `font-mono` class, which resolves to Inter
  with tabular numerals so columns still line up.

  Inside panels, text sits on the **Wise type scale**, which `globals.css` defines as utilities.
  Use these, not arbitrary `text-[Npx]`: the half-pixel sizes the old theme used (11.5, 12.5,
  13.5) are what made the panels read as a different, denser face.

  | utility | size / line | use |
  | --- | --- | --- |
  | `text-caption` | 12 / 16 | fine print, axis labels, table heads, legends |
  | `text-body-sm` | 14 / 20 | labels, secondary body, table body, controls |
  | `text-body` | 16 / 24 | list-row names, default body |
  | `text-body-lg` | 20 / 28 | panel titles (`font-semibold`) |
  | `text-display-xs` | 24 / 31, −0.02em | stat figures, dialog titles |

  Weight is **400 or 600** (`font-semibold`), never `font-medium`; 900 is only for the display
  face. Page titles are `font-display font-black` (`<PageHeader>` owns it). Chart tick labels
  are 12px via `bareAxis`, and the chart tooltip is an inverse card (`CHART_HOST_STYLE`).
  Labels are sentence case — the letterspaced uppercase micro-label survives only on table
  column heads (`<TableHead>`).

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
- `--primary` / `--brand` (Wise Green `#9fe870`) is the **action** colour — the primary
  button, the current nav row's disc, the brand mark. Gains are a *different* green, the
  semantic `--accent-brand` (`#054d28`), never Wise Green: Wise keeps its brand accent out
  of status, so a profit never reads as "click me".
- The value line on charts is `--chart-ink` (ink: a value series is neutral, not a gain).
  `--chart-gold` is the capital-deployed line, which the design draws as dashed grey. The
  name is historical; it is deliberately NOT loss-red, or "money you put in" would read as
  a warning about the money.
- Where value and cost are drawn together, the band between them is filled by sign —
  positive wash above the cost line, negative below it — and the wash under the *lower*
  line goes neutral grey.
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
