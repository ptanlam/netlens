// Self-check for lib/score.ts: `node scripts/check-streak.mjs` (Node 24 strips the types).
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// lib/score.ts imports "./format" without an extension, as the bundler allows; let Node find it.
registerHooks({
  resolve: (spec, ctx, next) => {
    try { return next(spec, ctx); } catch (e) { if (spec.startsWith(".")) return next(`${spec}.ts`, ctx); throw e; }
  },
});
const { commitment, streak } = await import("../lib/score.ts");

const world = (over) => ({
  today: "2026-10-15", investedByMonth: {}, savings: [], released: [], bar: 10_000_000, barSource: "recurring", ...over,
});
const month = (s, key) => s.months.find((m) => m.month === key);

// A deposit counts when it goes in; withdrawing it and buying shares the same month doesn't count again.
const s = streak(world({
  savings: [{ start_date: "2026-08-03", principal: 100_000_000 }],
  investedByMonth: { "2026-09": 105_000_000 },
  released: [{ date: "2026-09-20", amount: 103_000_000, from: "deposit" }],
}));
assert.equal(month(s, "2026-08").total, 100_000_000);
assert.equal(month(s, "2026-09").total, 2_000_000);
assert.equal(month(s, "2026-09").reused, 103_000_000);
assert.deepEqual(month(s, "2026-09").levers, { invest: 2_000_000, deposit: 0 });

// Never below zero, a month later offsets nothing, and a payout nobody reinvests isn't subtracted.
const t = streak(world({
  investedByMonth: { "2026-08": 5_000_000, "2026-09": 20_000_000 },
  savings: [{ start_date: "2026-08-10", principal: 10_000_000 }],
  released: [{ date: "2026-08-25", amount: 50_000_000, from: "sale" }],
}));
assert.equal(month(t, "2026-08").total, 0);
assert.deepEqual(month(t, "2026-08").levers, { invest: 0, deposit: 0 });
assert.equal(month(t, "2026-08").reused, 15_000_000);
assert.equal(month(t, "2026-09").total, 20_000_000);
assert.equal(month(t, "2026-09").reused, 0);

// A sale's proceeds offset investments before new deposits.
const u = streak(world({
  investedByMonth: { "2026-10": 6_000_000 },
  savings: [{ start_date: "2026-10-01", principal: 8_000_000 }],
  released: [{ date: "2026-10-02", amount: 9_000_000, from: "sale" }],
}));
assert.deepEqual(month(u, "2026-10").levers, { invest: 0, deposit: 5_000_000 });

// A withdrawal from savings comes off the month's deposits first, and only the rest of it
// cancels shares bought that month; a withdrawal alone takes nothing below zero.
const w = streak(world({
  investedByMonth: { "2026-10": 6_000_000 },
  savings: [{ start_date: "2026-10-01", principal: 8_000_000 }],
  released: [{ date: "2026-10-05", amount: 9_000_000, from: "deposit" }],
}));
assert.deepEqual(month(w, "2026-10").levers, { invest: 5_000_000, deposit: 0 });
assert.equal(month(w, "2026-10").withdrawn, 8_000_000);
assert.equal(month(w, "2026-10").reused, 1_000_000);
assert.equal(month(w, "2026-10").total, 5_000_000);
const x = streak(world({
  investedByMonth: { "2026-09": 12_000_000 },
  savings: [{ start_date: "2026-09-02", principal: 20_000_000 }],
  released: [{ date: "2026-09-25", amount: 5_000_000, from: "deposit" }],
}));
assert.deepEqual(month(x, "2026-09").levers, { invest: 12_000_000, deposit: 15_000_000 });
assert.equal(month(x, "2026-09").reused, 0);
// A sale's proceeds and a deposit's payout pool in the month: selling shares to buy others
// counts only what was added on top of the proceeds.
const v = streak(world({
  investedByMonth: { "2026-09": 80_000_000 },
  released: [{ date: "2026-09-01", amount: 50_000_000, from: "sale" }, { date: "2026-09-18", amount: 20_000_000, from: "deposit" }],
}));
assert.equal(month(v, "2026-09").total, 10_000_000);
assert.equal(month(v, "2026-09").reused, 70_000_000);
console.log("streak ok");

// The commitment: automatic falls back from rules to goal plans; a pinned source never falls back.
const plans = [{ monthly_plan: 4_000_000, archived: 0 }, { monthly_plan: 9_000_000, archived: 1 }];
assert.deepEqual(commitment(6_000_000, plans), { bar: 6_000_000, barSource: "recurring" });
assert.deepEqual(commitment(0, plans), { bar: 4_000_000, barSource: "goals" });
assert.deepEqual(commitment(6_000_000, plans, { mode: "goals", amount: null }), { bar: 4_000_000, barSource: "goals" });
assert.deepEqual(commitment(0, plans, { mode: "recurring", amount: null }), { bar: 0, barSource: "none" });
assert.deepEqual(commitment(6_000_000, plans, { mode: "custom", amount: 15_000_000 }), { bar: 15_000_000, barSource: "custom" });
assert.deepEqual(commitment(6_000_000, plans, { mode: "custom", amount: null }), { bar: 0, barSource: "none" });
