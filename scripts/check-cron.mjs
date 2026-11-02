// Self-check for lib/cron.ts: `node scripts/check-cron.mjs` (Node 24 strips the types).
import assert from "node:assert/strict";
import { cronLines, cronMatches, parseCron } from "../lib/cron.ts";

const at = (expr, moment) => cronMatches(parseCron(expr), moment);
// [minute, hour, day, month, weekday]; 2026-10-12 is a Monday, 2026-10-10 a Saturday.
assert.equal(at("*/5 9-14 * * 1-5", [0, 9, 12, 10, 1]), true);
assert.equal(at("*/5 9-14 * * 1-5", [55, 14, 12, 10, 1]), true);
assert.equal(at("*/5 9-14 * * 1-5", [0, 15, 12, 10, 1]), false);
assert.equal(at("*/5 9-14 * * 1-5", [3, 10, 12, 10, 1]), false);
assert.equal(at("*/5 9-14 * * 1-5", [0, 10, 10, 10, 6]), false);
assert.equal(at("0 * * * *", [0, 3, 10, 10, 6]), true);
assert.equal(at("0 * * * 7", [0, 3, 11, 10, 0]), true); // 7 = Sunday too
assert.equal(at("10-20/5 * * * *", [15, 0, 1, 1, 4]), true);
assert.equal(at("10/20 * * * *", [50, 0, 1, 1, 4]), true);
assert.equal(at("0 0 1 * 1", [0, 0, 12, 10, 1]), true); // dom OR dow when both are set
assert.equal(at("0 0 1 * 1", [0, 0, 13, 10, 2]), false);
assert.equal(at("1,2,3 * * * *", [2, 0, 1, 1, 0]), true);
// d#n: the n-th such weekday. 2026-11-11 is November's 2nd Wednesday, 11-04 its 1st.
assert.equal(at("0 9 * * 3#2", [0, 9, 11, 11, 3]), true);
assert.equal(at("0 9 * * 3#2", [0, 9, 4, 11, 3]), false);
assert.equal(at("0 9 * * 3#2", [0, 9, 12, 11, 4]), false);
assert.equal(at("0 9 * * 0#1,6", [0, 9, 1, 11, 0]), true);  // 1st Sunday, plus every Saturday
assert.equal(at("0 9 * * 0#1,6", [0, 9, 8, 11, 0]), false);
assert.equal(at("0 9 * * 0#1,6", [0, 9, 14, 11, 6]), true);
assert.equal(at("0 9 * * 7#1", [0, 9, 1, 11, 0]), true);    // 7 = Sunday here too
assert.equal(at("0 9 * * 5#5", [0, 9, 29, 5, 5]), true);    // a 5th Friday, when there is one
assert.equal(at("0 9 15 * 3#2", [0, 9, 15, 11, 0]), true);  // dom OR the n-th weekday
for (const bad of ["* * * * 3#0", "* * * * 3#6", "* * * * 8#1", "* * * * 3#"])
  assert.throws(() => parseCron(bad), undefined, bad);
for (const bad of ["* * * *", "60 * * * *", "5-1 * * * *", "*/0 * * * *", "a * * * *"])
  assert.throws(() => parseCron(bad), undefined, bad);
assert.deepEqual(cronLines("*/5 9-14 * * 1-5\n\n# hourly\n0 * * * *  # rest\n"), ["*/5 9-14 * * 1-5", "0 * * * *"]);
assert.deepEqual(cronLines("0 9 * * 3#2 # 2nd Wednesday"), ["0 9 * * 3#2"]); // not a comment
console.log("cron ok");
