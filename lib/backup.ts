/**
 * Nightly backup: the whole D1 database as one SQL file in R2 (`BACKUPS`, a bucket of its
 * own), written by the backup cron in `custom-worker.ts`.
 *
 * Plain SQL rather than D1's export API, because that API needs an account token the Worker
 * doesn't hold, and SQL because restoring is then one command into an empty database:
 * `wrangler d1 execute <db> --remote --file <dump>.sql` (docs/CLOUDFLARE.md#backups). The
 * dump carries the schema and `d1_migrations` too, so the restored database knows which
 * migrations it already has.
 *
 * Self-contained on purpose (no `lib/db` import): `scripts/check-backup.mjs` runs it under
 * plain Node against `node:sqlite`.
 */

type Row = Record<string, unknown>;
/** The slice of `D1Database` this needs, so the self-check can hand it a stand-in. */
export type Queryable = { prepare(sql: string): { all<T = Row>(): Promise<{ results: T[] }> } };

/** A value as an SQL literal. D1 hands a BLOB back as an array of bytes. */
function literal(v: unknown): string {
  if (v == null) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return String(v);
  if (Array.isArray(v) || v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
    const bytes = Array.isArray(v) ? v
      : Array.from(v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    return `X'${bytes.map((b: number) => b.toString(16).padStart(2, "0")).join("")}'`;
  }
  return `'${String(v).replaceAll("'", "''")}'`;
}

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;

export async function dumpSql(d1: Queryable): Promise<string> {
  // `_cf_%` is D1's own bookkeeping, `sqlite_%` SQLite's (AUTOINCREMENT counters rebuild
  // themselves from the inserted ids).
  const { results: objects } = await d1
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type = 'table' DESC, name",
    )
    .all<{ type: string; name: string; sql: string }>();
  const out = ["PRAGMA defer_foreign_keys = TRUE;"];
  for (const o of objects) {
    out.push(`${o.sql};`);
    if (o.type !== "table") continue;
    const { results: rows } = await d1.prepare(`SELECT * FROM ${ident(o.name)}`).all<Row>();
    for (const r of rows) {
      const cols = Object.keys(r);
      out.push(`INSERT INTO ${ident(o.name)} (${cols.map(ident).join(", ")}) VALUES (${cols.map((c) => literal(r[c])).join(", ")});`);
    }
  }
  return out.join("\n") + "\n";
}

/** Dump the database to `netlens-YYYY-MM-DD.sql.gz` (UTC date of `at`); returns its key. */
export async function backupTo(bucket: R2Bucket, d1: Queryable, at: Date): Promise<string> {
  const key = `netlens-${at.toISOString().slice(0, 10)}.sql.gz`;
  const gz = new Blob([await dumpSql(d1)]).stream().pipeThrough(new CompressionStream("gzip"));
  // Buffered: R2 wants a stream of known length, and a dump of this app is a few MB at most.
  await bucket.put(key, await new Response(gz).arrayBuffer(), {
    httpMetadata: { contentType: "application/sql", contentEncoding: "gzip" },
  });
  return key;
}
