// Self-check for lib/score.ts: `node scripts/check-streak.mjs` (Node 24 strips the types).
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// lib/score.ts imports "./format" without an extension, as the bundler allows; let Node find it.
registerHooks({
  resolve: (spec, ctx, next) => {
    try { return next(spec, ctx); } catch (e) { if (spec.startsWith(".")) return next(`${spec}.ts`, ctx); throw e; }
  },
});
const { streak } = await import("../lib/score.ts");

const world = (over) => ({
  today: "2026-10-15", investedByMonth: {}, savings: [], released: [], bar: 10_000_000, barSource: "recurring", ...over,
});
const month = (s, key) => s.months.find((m) => m.month === key);

// A deposit counts when it goes in; withdrawing it and buying shares the same month doesn't count again.
const s = streak(world({
  savings: [{ start_date: "2026-08-03", principal: 100_000_000 }],
  investedByMonth: { "2026-09": 105_000_000 },
  released: [{ date: "2026-09-20", amount: 103_000_000 }],
}));
assert.equal(month(s, "2026-08").total, 100_000_000);
assert.equal(month(s, "2026-09").total, 2_000_000);
assert.equal(month(s, "2026-09").reused, 103_000_000);
assert.deepEqual(month(s, "2026-09").levers, { invest: 2_000_000, deposit: 0 });

// Never below zero, a month later offsets nothing, and a payout nobody reinvests isn't subtracted.
const t = streak(world({
  investedByMonth: { "2026-08": 5_000_000, "2026-09": 20_000_000 },
  savings: [{ start_date: "2026-08-10", principal: 10_000_000 }],
  released: [{ date: "2026-08-25", amount: 50_000_000 }],
}));
assert.equal(month(t, "2026-08").total, 0);
assert.deepEqual(month(t, "2026-08").levers, { invest: 0, deposit: 0 });
assert.equal(month(t, "2026-08").reused, 15_000_000);
assert.equal(month(t, "2026-09").total, 20_000_000);
assert.equal(month(t, "2026-09").reused, 0);

// Investments are offset before new deposits.
const u = streak(world({
  investedByMonth: { "2026-10": 6_000_000 },
  savings: [{ start_date: "2026-10-01", principal: 8_000_000 }],
  released: [{ date: "2026-10-02", amount: 9_000_000 }],
}));
assert.deepEqual(month(u, "2026-10").levers, { invest: 0, deposit: 5_000_000 });
console.log("streak ok");
