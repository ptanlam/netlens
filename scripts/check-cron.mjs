// Self-check for lib/cron.ts: `node scripts/check-cron.mjs` (Node 24 strips the types).
import assert from "node:assert/strict";
import { cronDayMatcher, cronLines, cronMatches, parseCron } from "../lib/cron.ts";

// [minute, hour, day, month, weekday] in 2026, local time; the weekday is only a note to the
// reader, as the date fixes it. 2026-10-12 is a Monday, 2026-10-10 a Saturday.
const at = (expr, [min, hour, day, month]) => cronMatches(parseCron(expr), new Date(2026, month - 1, day, hour, min));
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
// What croner brings: the last day / last weekday, names, and seconds never mattering.
assert.equal(at("0 0 L * *", [0, 0, 28, 2, 6]), true);
assert.equal(at("0 0 L * *", [0, 0, 27, 2, 5]), false);
assert.equal(at("0 9 * * 5#L", [0, 9, 27, 11, 5]), true);    // Nov 2026's last Friday
assert.equal(at("0 9 * * 5#L", [0, 9, 20, 11, 5]), false);
assert.equal(at("0 9 * * MON-FRI", [0, 9, 12, 10, 1]), true);
assert.equal(cronMatches(parseCron("0 9 * * *"), new Date(2026, 10, 11, 9, 0, 42)), true);
// Read in the app's timezone, whatever the runtime's: 09:00 in Ho Chi Minh City is 02:00 UTC.
assert.equal(cronMatches(parseCron("0 9 * * *", "Asia/Ho_Chi_Minh"), new Date(Date.UTC(2026, 10, 11, 2, 0))), true);
assert.equal(cronMatches(parseCron("0 9 * * *", "Asia/Ho_Chi_Minh"), new Date(Date.UTC(2026, 10, 11, 9, 0))), false);
// A day matcher ignores minute and hour.
assert.equal(cronDayMatcher("*/5 9-14 * * 3#2")(new Date(2026, 10, 11)), true);
assert.equal(cronDayMatcher("*/5 9-14 * * 3#2")(new Date(2026, 10, 12)), false);
for (const bad of ["* * * * 3#0", "* * * * 3#6", "* * * * 8#1", "* * * * 3#", "* * * * 3#25", "0 * * * * *"])
  assert.throws(() => parseCron(bad), undefined, bad);
for (const bad of ["* * * *", "60 * * * *", "5-1 * * * *", "*/0 * * * *", "a * * * *"])
  assert.throws(() => parseCron(bad), undefined, bad);
assert.deepEqual(cronLines("*/5 9-14 * * 1-5\n\n# hourly\n0 * * * *  # rest\n"), ["*/5 9-14 * * 1-5", "0 * * * *"]);
assert.deepEqual(cronLines("0 9 * * 3#2 # 2nd Wednesday"), ["0 9 * * 3#2"]); // not a comment
console.log("cron ok");
