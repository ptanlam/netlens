# Running on Cloudflare Workers

The app is deployed as a Worker via [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare),
with **D1** for storage and a **Cron Trigger** for price refreshes.

## First-time setup

```bash
pnpm install
npx wrangler login
npx wrangler d1 create netlens      # copy the database_id it prints
```

Paste that id into `wrangler.jsonc` (it ships with a `PLACEHOLDER_…` value), then:

```bash
pnpm cf-typegen                  # regenerate worker-configuration.d.ts
pnpm db:migrate                  # apply migrations/ to the LOCAL D1
pnpm db:migrate:remote           # ...and to production
```

Set the password as a secret (not a var — `wrangler.jsonc` is committed):

```bash
npx wrangler secret put APP_PASSWORD
```

Locally, `APP_PASSWORD` comes from `.dev.vars` instead (git-ignored). **Quote the value
there.** `.dev.vars` is parsed as dotenv, so an unquoted `#` starts an inline comment and the
password is silently truncated at it — the Worker then rejects a cookie that production
accepts, and the only symptom is being bounced to `/login` forever:

```
APP_PASSWORD="pa#ssword"     # quoted: correct
APP_PASSWORD=pa#ssword       # parsed as "pa"
```

`wrangler secret put` reads stdin rather than dotenv, so production is unaffected by this.

## Bringing your data across

The authoritative copy lives on the **Railway** volume (`netlens-volume`, mounted at
`/app/data`), not in the local `data/investments.db` — that one is whatever your last local
run left behind and is typically stale. Pull a snapshot from Railway first.

Do not just `cat` the file down. It runs in WAL mode, and the WAL is routinely several MB of
writes that are not yet in the main file, so a naive copy silently loses recent rows. There
is no `sqlite3` binary in the container, but better-sqlite3 is, and its `.backup()` gives a
consistent snapshot without disturbing the live database:

```bash
cat > /tmp/snap.js <<'EOF'
const Database = require('/app/node_modules/better-sqlite3');
new Database('/app/data/investments.db', { readonly: true })
  .backup('/tmp/snapshot.db').then(() => console.log('ok'));
EOF
railway ssh "echo $(base64 < /tmp/snap.js | tr -d '\n') | base64 -d > /tmp/snap.js && node /tmp/snap.js"
railway ssh "gzip -9c /tmp/snapshot.db | base64" \
  | grep -E '^[A-Za-z0-9+/=]+$' | tr -d '\n' | base64 -d | gunzip > railway.db
sqlite3 railway.db "PRAGMA integrity_check;"     # expect: ok
```

Then dump and load it. Run the migrations **first** — they own the schema; the dump is
data-only:

```bash
./scripts/dump-for-d1.py railway.db d1-import.sql
npx wrangler d1 execute netlens --local  --file=d1-import.sql
npx wrangler d1 execute netlens --remote --file=d1-import.sql
```

The dump uses `INSERT OR REPLACE`, so re-running it updates rows and adds new ones — but it
will **not** remove a row that you deleted upstream. To make an import authoritative, clear
the data tables first (leave `d1_migrations` alone):

```bash
npx wrangler d1 execute netlens --remote --command \
  "DELETE FROM debt_payments; DELETE FROM goal_contributions; DELETE FROM price_history;
   DELETE FROM transactions; DELETE FROM savings; DELETE FROM debts; DELETE FROM goals;
   DELETE FROM instruments; DELETE FROM price_sources; DELETE FROM recurring_rules;
   DELETE FROM meta;"
```

Afterwards, check the counts match the source — the failure mode this guards against is an
import that reports success while quietly landing values in the wrong columns:

```bash
npx wrangler d1 execute netlens --remote --command \
  "SELECT (SELECT COUNT(*) FROM transactions) tx, (SELECT COUNT(*) FROM price_history) ph,
          (SELECT COUNT(*) FROM debts) debts, (SELECT COUNT(*) FROM savings) sav"
```

Read the header of `scripts/dump-for-d1.py` before changing it. It exists rather than a
plain `sqlite3 .dump` for a reason that cost real debugging time: `.dump` writes positional
`INSERT INTO t VALUES (…)`, which silently assumes the destination column *order* matches.
It doesn't — the live database grew `goals.position`, `debts.kind`, `debts.monthly_payment`
and `savings.goal_id` via `ALTER TABLE`, so SQLite appended them at the end, while
`migrations/0001_init.sql` declares them in their logical place. A positional import
"succeeds" with matching row counts and then renders `NaN`. The script names every column.

## Day to day

```bash
pnpm dev            # next dev, with D1 bound through initOpenNextCloudflareForDev()
pnpm preview        # build + run the real Worker locally (wrangler dev)
pnpm run deploy     # build + deploy
```

`deploy` needs the explicit `run`: bare `pnpm deploy` is pnpm's own workspace command
(it copies a package into a directory) and will not touch this script. The others have no
builtin of that name, so the shorthand is fine.

`pnpm preview` is the one that catches Workers-specific breakage; `next dev` still runs
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

## The DCVFM feed, and why `lib/tls.ts` went away

`lib/tls.ts` and `certs/*.pem` are gone. They existed because `dragoncapital.com.vn` serves
an **incomplete TLS chain** (leaf only, no intermediate). Browsers and curl quietly fetch
the missing intermediate via the certificate's AIA URL; **Node does not**, so under Node the
`dcvfm` source died with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` and needed a custom undici
dispatcher that trusted the intermediate from disk.

The Workers runtime does not share that limitation — it completes the chain itself. So the
workaround is not merely unsupported on Workers, it is **unnecessary**. Verified in
production rather than assumed: after deploying, a price refresh updated DCDS via `dcvfm`
and moved its `last_price_at` forward.

```
$ wrangler d1 execute netlens --remote --command \
    "SELECT name, price_source, last_price_at FROM instruments WHERE name='DCDS'"
DCDS | dcvfm | 2026-07-27T14:29:14      # imported row said 14:22:12 — the Worker rewrote it
```

So there is **no functional loss** here, and DCDS should stay on `dcvfm` — which `lib/db.ts`
records as a deliberate single-source choice. Nothing to do.

**Local `wrangler dev` is the exception.** The workerd binary on your machine does not do
what the edge does, so both the live price and the history fetch fail there with
`DCDS: internal error`, on every strategy that hits `dragoncapital.com.vn`. Expect one
failed holding in the toast when refreshing or rebuilding locally; it is an artefact of the
local runtime, not of the change you are testing. Check against production before believing
DCDS is broken.

If you ever do want to move it, fmarket lists the same fund, the holding's `symbol` is
already `DCDS` (what fmarket keys on via `key_field: shortName`), and `history_strategy` is
`fmarket` there too:

```bash
npx wrangler d1 execute netlens --remote \
  --command "UPDATE instruments SET price_source='fmarket' WHERE name='DCDS'"
```
