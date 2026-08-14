# Investment visualization

A personal web app to track investments and see them charted — a Next.js +
shadcn/ui rewrite of the original Flask version (`~/Projects/personal/investment-visualization`).
The **SQLite database is the source of truth**; copy `data/investments.db` from
the old app to migrate (same schema).

## Stack

- **Next.js 16** (App Router, Server Actions, Turbopack) + React 19
- **shadcn/ui** (Base UI primitives) + Tailwind CSS 4
- **Recharts** via the shadcn chart wrapper
- **Cloudflare D1** for storage, via `@opennextjs/cloudflare` (see `docs/CLOUDFLARE.md`)

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:3000
# or production:
pnpm build && pnpm start
```

## Pages

- `/` — dashboard: **net worth** panel (investments + savings − debts), portfolio /
  invested / P&L stat cards, a **date-range picker** (Year to date, This year, Last 12
  months, All time, Custom) driving invested-per-month, cumulative, and P&L-over-time
  charts, plus a live allocation donut, holdings bars, and P&L-by-holding
- `/investments` — what you hold: portfolio/invested/P&L stat cards, holdings grouped by
  asset type, each expanding to its price source, recurring rules and a link to its
  history; archived holdings; the "Awaiting fund units" (T+1/T+2) banner
- `/transactions` — what you did: every buy and sell in a date window you pick and can
  brush-zoom, filtered by holding and buy/sell, over summary tiles, cumulative-deployed
  and deployed-by-month charts and a sortable table. Add/edit/delete dialogs, CSV export.
  `?holding=<name>` opens it filtered to one holding — how `/investments` links through
- `/savings` — term deposits: principal, interest rate, term, estimated current &
  maturity value
- `/debts` — loans and **revolving credit cards**: principal/balance, rate, term (or
  revolving), estimated amount owed
- `/recurring` — auto-DCA rules (weekly/monthly, pause/resume, backfilled on load)
- `GET /export.csv`, `GET /api/pnl-history`, `GET /healthz`

## Contributing / agents

Start with [`AGENTS.md`](AGENTS.md) and the [`docs/`](docs/) folder
(architecture, the add-a-feature recipe, conventions, and the run/verify workflow).

## Live prices

Same sources as the Flask version, ported to `lib/prices.ts`:
CoinGecko (crypto, VND), Yahoo Finance (VN stocks), fmarket.vn (fund NAVs,
e.g. DCDS), vcbf.com scrape (VCBF-TBF). Prices are fetched on demand via
**Refresh prices**; daily history is cached in `price_history` (≤ every 12h)
for the P&L-over-time chart.

## Configuration (env)

| Variable       | Default               | Meaning                             |
|----------------|-----------------------|-------------------------------------|
| `DB` (binding) | `wrangler.jsonc`      | D1 database, not an env var         |

There is no login setting: the deployed app is guarded by **Cloudflare Access** in front of
`netlens.lamphan.com`, so nothing runs in the app to authenticate you. Locally there is no
gate at all. See [`docs/CLOUDFLARE.md`](docs/CLOUDFLARE.md#authentication-is-cloudflare-access).

## Notes

- Amounts are whole-VND integers (signed: + buy, − sell/withdraw).
- `data/` is git-ignored — it's your financial data; use **Export CSV** as backup.
- The business logic in `lib/db.ts`, `lib/prices.ts`, `lib/pnl.ts` is a direct
  port of the Flask app's `db.py` / `prices.py` / `pnl.py`.
