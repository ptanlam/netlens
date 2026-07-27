#!/usr/bin/env python3
"""Dump the local better-sqlite3 database into SQL that D1 can import.

    ./scripts/dump-for-d1.py [path/to/investments.db] [out.sql]

Then load it (schema first — the migrations own that):

    npm run db:migrate                                          # local
    npx wrangler d1 execute netlens --local  --file=d1-import.sql
    npm run db:migrate:remote                                   # production
    npx wrangler d1 execute netlens --remote --file=d1-import.sql

Why this exists rather than a plain `sqlite3 .dump`:

  * **Columns are named explicitly.** `.dump` emits positional `INSERT INTO t VALUES (…)`,
    which silently requires the destination column *order* to match the source. It does not:
    the live database grew `goals.position`, `debts.kind`, `debts.monthly_payment` and
    `savings.goal_id` through `ALTER TABLE`, so SQLite appended them at the end, whereas
    `migrations/0001_init.sql` declares them in their logical place. A positional import
    therefore lands `position` in `archived`, `kind` in `note`, and so on — it "succeeds",
    row counts match, and the app quietly renders NaN. Naming the columns makes the import
    order-independent.
  * **WAL is checkpointed first**, on a copy. The live database runs in WAL mode, so recent
    writes sit in `-wal` rather than the main file and a naive dump misses them.
  * **`INSERT OR REPLACE`**, so the import is re-runnable.
  * **`price_sources` is cleared first**, making the import authoritative for that table.
    Built-ins are ordinary rows you may delete — the old code tracked that with a
    `price_sources_seeded` flag so a restart couldn't resurrect them. Migration 0002 runs
    before this import and knows nothing about that flag, so without the DELETE any built-in
    you had removed would come back.
  * **`sqlite_sequence` is skipped.** D1 rejects writes to it, and AUTOINCREMENT falls back
    to `max(rowid)+1`, so ids still only ever go up.

The output contains real financial data. Keep it out of git — the default name is ignored.
"""
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

src = Path(sys.argv[1] if len(sys.argv) > 1 else "data/investments.db")
out = Path(sys.argv[2] if len(sys.argv) > 2 else "d1-import.sql")

if not src.exists():
    sys.exit(f"no such database: {src}")

with tempfile.TemporaryDirectory() as tmp:
    work = Path(tmp) / "db"
    shutil.copy(src, work)
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(src) + suffix)
        if sidecar.exists():
            shutil.copy(sidecar, str(work) + suffix)

    con = sqlite3.connect(work)
    con.execute("PRAGMA wal_checkpoint(TRUNCATE)")

    tables = [
        r[0]
        for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]

    lines, counts = [], {}
    for table in tables:
        cols = [r[1] for r in con.execute(f'PRAGMA table_info("{table}")')]
        collist = ", ".join(f'"{c}"' for c in cols)
        values = " || ',' || ".join(f'quote("{c}")' for c in cols)
        rows = [
            r[0]
            for r in con.execute(
                f'SELECT \'INSERT OR REPLACE INTO "{table}" ({collist}) VALUES (\' '
                f"|| {values} || ');' FROM \"{table}\""
            )
        ]
        counts[table] = len(rows)
        if not rows:
            continue
        if table == "price_sources":
            lines.append('DELETE FROM "price_sources";')
        lines.extend(rows)

    out.write_text("\n".join(lines) + "\n")
    con.close()

print(f"wrote {out} ({len(lines)} statements)")
print("\nrow counts in source:")
for table, n in sorted(counts.items()):
    print(f"  {table:<20} {n}")
