// Self-check for deposit movements in lib/savings.ts. Run: node scripts/check-savings.mjs
import assert from "node:assert/strict";
import { currentValue, freshPrincipal, maturityDate, maturityValue, netPrincipal, releasedFrom, summarize, termFor } from "../lib/savings.ts";

const at = (d) => new Date(`${d}T00:00:00Z`);
const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const base = { principal: 100_000_000, rate: 6, start_date: "2026-01-01", term_months: 12, interest_type: "simple" };

// No movements: exactly as before (simple, half a year ≈ 3%).
near(currentValue(base, at("2026-07-02")), 100_000_000 * (1 + 0.06 * 182 / 365));

// A withdrawal stops earning the day it leaves; what it earned before stays.
const w = { ...base, movements: [{ date: "2026-07-02", amount: -40_000_000 }] };
near(currentValue(w, at("2026-07-01")), currentValue(base, at("2026-07-01"))); // not yet
near(currentValue(w, at("2027-01-01")), maturityValue(base) - 40_000_000 * (1 + 0.06 * 183 / 365));
near(maturityValue(w), currentValue(w, at("2027-01-01")));
assert.equal(netPrincipal(w, at("2026-12-31")), 60_000_000);

// A top-up earns from the day it lands, and only until maturity.
const t = { ...base, movements: [{ date: "2026-07-02", amount: 10_000_000 }] };
near(currentValue(t, at("2028-01-01")), maturityValue(base) + 10_000_000 * (1 + 0.06 * 183 / 365));
assert.equal(summarize([t], at("2026-08-01")).principal, 110_000_000);

// Taking everything out of a compound deposit leaves nothing.
const c = { ...base, interest_type: "compound" };
const all = currentValue(c, at("2026-07-02"));
near(currentValue({ ...c, movements: [{ date: "2026-07-02", amount: -all }] }, at("2026-12-01")), 0);

// A withdrawal after maturity takes out of the matured value, which no longer grows.
const late = { ...base, movements: [{ date: "2027-03-01", amount: -maturityValue(base) }] };
near(currentValue(late, at("2027-06-01")), 0);

// Terms in other units: a 2-week deposit matures 14 days in, a 1-year one equals 12 months.
const twoWeeks = { ...base, term_months: 2, term_unit: "week" };
if (maturityDate(twoWeeks) !== "2026-01-15") throw new Error(maturityDate(twoWeeks));
near(maturityValue(twoWeeks), 100_000_000 * (1 + 0.06 * 14 / 365));
near(currentValue(twoWeeks, at("2027-01-01")), maturityValue(twoWeeks)); // stops at maturity
near(maturityValue({ ...base, term_months: 1, term_unit: "year" }), maturityValue(base));
if (maturityDate({ ...base, term_months: 45, term_unit: "day" }) !== "2026-02-15") throw new Error("day term");

// A rollover counts only what it adds on top of the old deposit's payout, and never below 0.
const payout = Math.round(maturityValue(base)); // 106.000.000
const next = { ...base, start_date: "2027-01-01" };
near(freshPrincipal({ ...next, principal: payout + 5_000_000 }, base), 5_000_000);
near(freshPrincipal({ ...next, principal: 50_000_000 }, base), 0);
near(freshPrincipal({ ...next, principal: 50_000_000 }), 50_000_000);

// Released money: each withdrawal, plus the payout on the day it was archived…
const gone = { ...w, archived_date: "2027-02-01" };
const left = Math.round(currentValue(w, at("2027-02-01")));
assert.deepEqual(releasedFrom(gone), [{ date: "2026-07-02", amount: 40_000_000 }, { date: "2027-02-01", amount: left }]);
assert.deepEqual(releasedFrom({ ...base, archived_date: null }), []);
// …less what a rollover took, which freshPrincipal already kept from counting twice.
const rolledAll = { ...base, archived_date: next.start_date };
assert.deepEqual(releasedFrom(rolledAll, { ...next, principal: payout + 5_000_000 }), []);
near(releasedFrom(rolledAll, { ...next, principal: 50_000_000 })[0].amount, payout - 50_000_000);

// Picking a maturity date: whole months when it lands on one, else days; always round-trips.
assert.deepEqual(termFor("2026-01-15", "2026-07-15"), { term: 6, unit: "month" });
assert.deepEqual(termFor("2026-01-31", "2026-02-28"), { term: 1, unit: "month" }); // month-end clamp
assert.deepEqual(termFor("2026-01-15", "2028-01-15", "year"), { term: 2, unit: "year" });
assert.deepEqual(termFor("2026-01-15", "2027-01-15"), { term: 12, unit: "month" });
assert.deepEqual(termFor("2026-01-15", "2026-02-20"), { term: 36, unit: "day" });
assert.deepEqual(termFor("2026-01-15", "2026-02-19", "week"), { term: 5, unit: "week" });
assert.equal(termFor("2026-01-15", "2026-01-15"), null);
assert.equal(termFor("2026-01-15", "2025-12-01"), null);
for (const [start, end] of [["2026-03-31", "2026-06-30"], ["2026-01-15", "2026-04-02"], ["2024-02-29", "2025-02-28"]]) {
  const t = termFor(start, end);
  assert.equal(maturityDate({ start_date: start, term_months: t.term, term_unit: t.unit }), end);
}

console.log("ok");
