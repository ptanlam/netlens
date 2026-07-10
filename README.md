# Investment visualization

A personal web app to track investments and see them charted — a Next.js +
shadcn/ui rewrite of the original Flask version (`~/Projects/personal/investment-visualization`).
The **SQLite database is the source of truth**; copy `data/investments.db` from
the old app to migrate (same schema).

## Stack

- **Next.js 16** (App Router, Server Actions, Turbopack) + React 19
- **shadcn/ui** (Base UI primitives) + Tailwind CSS 4
- **Recharts** via the shadcn chart wrapper
- **better-sqlite3** for storage (`data/investments.db`, WAL mode)

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
# or production:
npm run build && npm start
```

## Pages

- `/` — dashboard: **net worth** panel (investments + savings − debts), portfolio /
  invested / P&L stat cards, a **date-range picker** (Year to date, This year, Last 12
  months, All time, Custom) driving invested-per-month, cumulative, and P&L-over-time
  charts, plus a live allocation donut, holdings bars, and P&L-by-holding
- `/transactions` — full history (paginated) with an **Add-transaction dialog**, edit
  dialog, delete, CSV export, and the "Awaiting fund units" (T+1/T+2) section
- `/holdings` — per-instrument valuation: asset type, price source, symbol, quantity,
  manual value; Refresh-prices and Save buttons
- `/savings` — term deposits: principal, interest rate, term, estimated current &
  maturity value
- `/debts` — loans and **revolving credit cards**: principal/balance, rate, term (or
  revolving), estimated amount owed
- `/recurring` — auto-DCA rules (weekly/monthly, pause/resume, backfilled on load)
- `/login` — password sign-in (only when `APP_PASSWORD` is set; enforced by `proxy.ts`)
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
| `DB_PATH`      | `data/investments.db` | SQLite database location            |
| `APP_PASSWORD` | unset                 | Enables the login screen when set   |

## Notes

- Amounts are whole-VND integers (signed: + buy, − sell/withdraw).
- `data/` is git-ignored — it's your financial data; use **Export CSV** as backup.
- The business logic in `lib/db.ts`, `lib/prices.ts`, `lib/pnl.ts` is a direct
  port of the Flask app's `db.py` / `prices.py` / `pnl.py`.
