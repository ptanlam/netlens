/**
 * Cron for the price refresh schedule and recurring rules, on croner. Five fields —
 * `minute hour day-of-month month day-of-week` — each taking `*`, `n`, `a-b`, `*\/s`, `a-b/s`,
 * comma lists and names (`MON`, `JAN`); day-of-week 0–7, both 0 and 7 Sunday. Also `L`
 * (last: `L` the month's last day, `5#L` its last Friday), `W` (nearest weekday) and `#`
 * (the n-th weekday: `3#2` is the 2nd Wednesday). As in Vixie cron, when day-of-month and
 * day-of-week are both restricted a day matching *either* one matches.
 *
 * Seconds and year fields are refused: nothing here is finer than a minute. Client-safe.
 * Self-check: `node scripts/check-cron.mjs`.
 */
import { Cron } from "croner";

/** Each field's top value, for widening `n/s`. */
const FIELD_MAX = [59, 23, 31, 12, 7];

/** Parse one expression, read in `timezone` (the runtime's own when unset). Throws with a
 *  readable message on anything malformed. */
export function parseCron(expr: string, timezone?: string): Cron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`"${expr.trim()}" needs 5 fields, has ${parts.length}`);
  // croner takes a bare `3#` without complaint, but it's a typo, not a schedule.
  if (/#(?![1-5L](?:\D|$))/i.test(parts[4])) throw new Error(`"${parts[4]}" needs a week 1-5 or L after #`);
  // Vixie's `n/s` ("from n, every s") is `n-max/s` to croner, which refuses the short form.
  const fields = parts.map((f, i) => f.replace(/(^|,)(\d+)\/(\d+)/g, `$1$2-${FIELD_MAX[i]}/$3`));
  try {
    return new Cron(fields.join(" "), { timezone });
  } catch (e) {
    throw new Error((e as Error).message.replace(/^CronPattern: /, ""));
  }
}

/** Whether the minute `at` falls in matches. Its seconds are dropped: croner matches them
 *  too, and a tick is never exactly on the minute. */
export function cronMatches(cron: Cron, at: Date): boolean {
  return cron.match(new Date(Math.floor(at.getTime() / 60_000) * 60_000));
}

/** Whether `expr` matches some minute of a given day, read in the runtime's timezone — for a
 *  recurring rule, which runs once a day, so minute and hour don't matter. Throws like
 *  `parseCron`. */
export function cronDayMatcher(expr: string): (day: Date) => boolean {
  const [, , dom, month, dow] = expr.trim().split(/\s+/);
  parseCron(expr);
  const day = parseCron(`0 0 ${dom} ${month} ${dow}`);
  return (d) => day.match(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** The expressions in a schedule: one per line, blank lines and `#` comments ignored. A
 *  comment's `#` opens the line or follows a space, so `3#2` inside a field isn't one. */
export function cronLines(text: string): string[] {
  return text.split("\n").map((l) => l.replace(/(^|\s)#.*/, "").trim()).filter(Boolean);
}
