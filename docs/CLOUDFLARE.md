# Running on Cloudflare Workers

The app is deployed as a Worker via [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare),
with **D1** for storage and a **Cron Trigger** for price refreshes.

## First-time setup

```bash
npm install
npx wrangler login
npx wrangler d1 create netlens      # copy the database_id it prints
```

Paste that id into `wrangler.jsonc` (it ships with a `PLACEHOLDER_…` value), then:

```bash
npm run cf-typegen                  # regenerate worker-configuration.d.ts
npm run db:migrate                  # apply migrations/ to the LOCAL D1
npm run db:migrate:remote           # ...and to production
```

Set the password as a secret (not a var — `wrangler.jsonc` is committed):

```bash
npx wrangler secret put APP_PASSWORD
```

Locally, `APP_PASSWORD` comes from `.dev.vars` instead (git-ignored).

## Bringing your data across

The old deployment kept a SQLite file on a Docker volume. To move it into D1:

```bash
./scripts/dump-for-d1.py                                     # -> d1-import.sql
npx wrangler d1 execute netlens --local  --file=d1-import.sql
npx wrangler d1 execute netlens --remote --file=d1-import.sql
```

Run the migrations **first** — they own the schema; the dump is data-only.

Read the header of `scripts/dump-for-d1.py` before changing it. It exists rather than a
plain `sqlite3 .dump` for a reason that cost real debugging time: `.dump` writes positional
`INSERT INTO t VALUES (…)`, which silently assumes the destination column *order* matches.
It doesn't — the live database grew `goals.position`, `debts.kind`, `debts.monthly_payment`
and `savings.goal_id` via `ALTER TABLE`, so SQLite appended them at the end, while
`migrations/0001_init.sql` declares them in their logical place. A positional import
"succeeds" with matching row counts and then renders `NaN`. The script names every column.

## Day to day

```bash
npm run dev        # next dev, with D1 bound through initOpenNextCloudflareForDev()
npm run preview    # build + run the real Worker locally (wrangler dev)
npm run deploy     # build + deploy
```

`npm run preview` is the one that catches Workers-specific breakage; `next dev` still runs
on Node and will happily accept things the Worker won't.

Query the database directly:

```bash
npx wrangler d1 execute netlens --local  --command "SELECT COUNT(*) FROM transactions"
npx wrangler d1 execute netlens --remote --command "SELECT COUNT(*) FROM transactions"
```

D1 rejects compound `SELECT`s with many terms — `SELECT (SELECT …) a, (SELECT …) b` works
where a long `UNION ALL` chain returns `too many terms in compound SELECT`.

## Things that changed, and why

**The schema is in `migrations/`, not a `SCHEMA` string.** Adding a table means adding a
numbered file. The old `CREATE TABLE IF NOT EXISTS`-on-every-boot trick, and the
`migrate()` ALTER-ladder beside it, are both gone.

**Every `lib/db.ts` function is async.** D1 has no synchronous API. The pure maths in
`goals.ts` / `savings.ts` was untouched — `db.ts` depends on those and never the reverse, so
the async only spreads outward into pages and actions.

**Watch for N+1s.** On better-sqlite3 a query inside a loop was free. On D1 it's a network
round trip, so several loops were hoisted into a single query plus a `Map` (see
`lib/pnl.ts`, `lib/prices.ts`, `app/investments/page.tsx`, `app/goals/page.tsx`). Independent
reads in a page go out through one `Promise.all`.

**No interactive transactions.** `db.transaction(() => …)` became `db().batch([…])`, which
is atomic but can't branch mid-way.

**Positional parameters only.** D1 doesn't support better-sqlite3's `@named` binding.

**The price cron lives in `custom-worker.ts`.** A Worker has no long-lived process to hold
`setInterval`, so `instrumentation.ts` was replaced by a `scheduled()` handler on the
schedule in `wrangler.jsonc`.

**The password gate also lives in `custom-worker.ts`.** It was `proxy.ts`. Next.js 16 runs
Proxy on the Node.js runtime and rejects a `runtime` override, and the adapter refuses
Node.js middleware — so no `proxy.ts` can build at all. Doing it in the Worker is arguably
where it belonged, and it now covers the route handlers (`/api/*`, `/export.csv`,
`/healthz`) that the old `matcher` let through.

**`keep_names: false` is load-bearing.** esbuild's keep-names rewrites functions to call a
`__name` helper. `next-themes` ships its no-flash script by stringifying a function into an
inline `<script>`, which by then has been rewritten — so the browser throws
`__name is not defined` and the stored theme is never applied on first paint.

## Known loss: the DCVFM price feed

`lib/tls.ts` is gone. It trusted extra intermediate CAs from `certs/*.pem` via a custom
undici dispatcher, because `dragoncapital.com.vn` serves an **incomplete TLS chain** (leaf
only, no intermediate). Browsers and curl quietly fetch the missing intermediate via the
cert's AIA URL; Node and the Workers runtime do not.

Workers cannot install a custom CA, so **the `dcvfm` source fails** — you'll see
`DCDS: internal error` in the price-refresh toast. Confirmed, not theoretical:

```
curl <dcvfm url>  -> 200
node fetch        -> UNABLE_TO_VERIFY_LEAF_SIGNATURE
```

**The fix is to move DCDS onto `fmarket`**, which lists the same fund and returned a NAV
identical to the stored one (91251.09) when checked. The holding's `symbol` is already
`DCDS`, which is what fmarket keys on (`key_field: shortName`), and `history_strategy` is
`fmarket` there too. Either switch it in Settings → the holding's price source, or:

```bash
npx wrangler d1 execute netlens --remote \
  --command "UPDATE instruments SET price_source='fmarket' WHERE name='DCDS'"
```

This is left as a decision rather than done for you: `lib/db.ts` recorded that DCVFM was
chosen deliberately as a single source, with no cross-checking against fmarket.
