// Self-check for lib/recurring.ts: `node scripts/check-recurring.mjs` (Node 24 strips the types).
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// lib/recurring.ts imports "./cron" without an extension, as the bundler allows; let Node find it.
registerHooks({
  resolve: (spec, ctx, next) => {
    try { return next(spec, ctx); } catch (e) { if (spec.startsWith(".")) return next(`${spec}.ts`, ctx); throw e; }
  },
});
const { occurrences, ruleMonthly } = await import("../lib/recurring.ts");

const d = (iso) => { const [y, m, day] = iso.split("-").map(Number); return new Date(y, m - 1, day); };
const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
const runs = (freq, start, after, until) =>
  [...occurrences(freq, d(start), after && d(after), d(until))].map(iso);

assert.deepEqual(runs("daily", "2026-02-27", null, "2026-03-02"), ["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
assert.deepEqual(runs("daily", "2026-01-01", "2026-10-26", "2026-10-28"), ["2026-10-27", "2026-10-28"]);
assert.deepEqual(runs("weekly", "2026-10-01", null, "2026-10-22"), ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"]);
assert.deepEqual(runs("weekly", "2026-10-01", "2026-10-08", "2026-10-22"), ["2026-10-15", "2026-10-22"]);
assert.deepEqual(runs("biweekly", "2026-10-01", null, "2026-11-12"), ["2026-10-01", "2026-10-15", "2026-10-29", "2026-11-12"]);
assert.deepEqual(runs("biweekly", "2026-10-01", "2026-10-20", "2026-11-12"), ["2026-10-29", "2026-11-12"]);
// Anchored on the 31st: clamps in short months, climbs back in long ones.
assert.deepEqual(runs("monthly", "2026-01-31", null, "2026-04-30"), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
assert.deepEqual(runs("monthly", "2026-01-31", "2026-02-28", "2026-04-30"), ["2026-03-31", "2026-04-30"]);
assert.deepEqual(runs("quarterly", "2025-11-30", null, "2026-12-31"), ["2025-11-30", "2026-02-28", "2026-05-30", "2026-08-30", "2026-11-30"]);
assert.deepEqual(runs("quarterly", "2025-11-30", "2026-05-30", "2026-12-31"), ["2026-08-30", "2026-11-30"]);
assert.deepEqual(runs("semiannually", "2024-08-31", null, "2026-03-01"), ["2024-08-31", "2025-02-28", "2025-08-31", "2026-02-28"]);
assert.deepEqual(runs("yearly", "2024-02-29", null, "2028-03-01"), ["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
assert.deepEqual(runs("yearly", "2024-02-29", "2027-02-28", "2028-03-01"), ["2028-02-29"]);
// Nothing before the start, and an unknown value runs monthly rather than not at all.
assert.deepEqual(runs("monthly", "2026-11-01", null, "2026-10-28"), []);
assert.deepEqual(runs("fortnightly?", "2026-08-15", null, "2026-10-28"), ["2026-08-15", "2026-09-15", "2026-10-15"]);

assert.equal(ruleMonthly({ amount: 1_200_000, freq: "monthly" }), 1_200_000);
assert.equal(ruleMonthly({ amount: 1_200_000, freq: "weekly" }), (1_200_000 * 52) / 12);
assert.equal(ruleMonthly({ amount: 1_200_000, freq: "biweekly" }), (1_200_000 * 26) / 12);
assert.equal(ruleMonthly({ amount: 1_200_000, freq: "quarterly" }), 400_000);
assert.equal(ruleMonthly({ amount: 1_200_000, freq: "semiannually" }), 200_000);
assert.equal(ruleMonthly({ amount: 1_200_000, freq: "yearly" }), 100_000);
assert.equal(ruleMonthly({ amount: 12_000, freq: "daily" }), 365_000);
console.log("recurring ok");

// Cron rules: once on each matching day, time fields ignored; `after` excludes its own day.
const cronRuns = (expr, start, after, until) =>
  [...occurrences("cron", d(start), after && d(after), d(until), expr)].map(iso);
assert.deepEqual(cronRuns("0 9 1,15 * *", "2026-11-01", null, "2026-12-15"), ["2026-11-01", "2026-11-15", "2026-12-01", "2026-12-15"]);
assert.deepEqual(cronRuns("0 9 1,15 * *", "2026-11-01", "2026-11-15", "2026-12-15"), ["2026-12-01", "2026-12-15"]);
assert.deepEqual(cronRuns("*/5 * * * 1", "2026-11-01", null, "2026-11-20"), ["2026-11-02", "2026-11-09", "2026-11-16"]); // Mondays
assert.deepEqual(cronRuns("0 0 L * *", "2026-11-01", null, "2026-12-01"), []); // malformed: never, not a crash
assert.deepEqual(cronRuns("0 0 30 2 *", "2026-01-01", null, "2030-01-01"), []);
assert.equal(ruleMonthly({ amount: 1_200_000, freq: "cron", cron: "0 9 1,15 * *" }), 2_400_000);
assert.equal(ruleMonthly({ amount: 1_200_000, freq: "cron", cron: "nope" }), 0);
console.log("cron rules ok");
