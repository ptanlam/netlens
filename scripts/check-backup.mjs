// Self-check for lib/backup.ts: node scripts/check-backup.mjs
// Dumps a database with awkward values, restores the dump into an empty one, and compares.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert';
import { dumpSql } from '../lib/backup.ts';

/** `node:sqlite` dressed as the slice of D1 that `dumpSql` reads. */
const asD1 = (db) => ({
  prepare: (sql) => ({ all: async () => ({ results: db.prepare(sql).all().map((r) => ({ ...r })) }) }),
});

const src = new DatabaseSync(':memory:');
src.exec(`
  CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT, amount INTEGER, quantity REAL, logo BLOB);
  CREATE INDEX idx_note ON transactions(note);
  CREATE TABLE "odd ""name""" (k TEXT);
  CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE _cf_KV (k TEXT);
`);
const ins = src.prepare('INSERT INTO transactions (note, amount, quantity, logo) VALUES (?, ?, ?, ?)');
ins.run("it's a \"quote\"; DROP TABLE x;--", -1500000, 0.123456789, null);
ins.run('Cổ tức đợt 1\nline two', 0, 26.67, new Uint8Array([0, 255, 16]));
ins.run(null, 9000000, null, null);
src.exec(`INSERT INTO "odd ""name""" VALUES ('x'); INSERT INTO d1_migrations VALUES (1, '0001_init.sql'); INSERT INTO _cf_KV VALUES ('skip')`);

const sql = await dumpSql(asD1(src));
const dst = new DatabaseSync(':memory:');
dst.exec(sql);

const all = (db, t) => db.prepare(`SELECT * FROM ${t}`).all().map((r) => ({ ...r }));
assert.deepStrictEqual(all(dst, 'transactions'), all(src, 'transactions'));
assert.deepStrictEqual(all(dst, '"odd ""name"""'), [{ k: 'x' }]);
assert.deepStrictEqual(all(dst, 'd1_migrations'), [{ id: 1, name: '0001_init.sql' }]);
assert.ok(!sql.includes('_cf_KV'), "D1's own tables are left out");
assert.ok(sql.includes('CREATE INDEX idx_note'));
// AUTOINCREMENT carries on after the restored ids rather than reusing one.
dst.prepare('INSERT INTO transactions (note) VALUES (?)').run('next');
assert.strictEqual(dst.prepare("SELECT id FROM transactions WHERE note = 'next'").get().id, 4);
console.log('ok');
