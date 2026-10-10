/**
 * A minimal 5-field cron matcher — `minute hour day-of-month month day-of-week` — for the
 * price refresh schedule. Each field takes `*`, `n`, `a-b`, `*\/s`, `a-b/s` and comma lists;
 * day-of-week is 0–7 with both 0 and 7 meaning Sunday. As in Vixie cron, when day-of-month
 * and day-of-week are both restricted a day matching *either* one matches.
 *
 * No names (`MON`, `JAN`) and no `@hourly` macros. Client-safe: no Node deps.
 */

const FIELDS: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

/** The wall-clock moment a schedule is asked about: [minute, hour, day, month, weekday]. */
export type CronMoment = [number, number, number, number, number];

type Parsed = { sets: Set<number>[]; domStar: boolean; dowStar: boolean };

function parseField(src: string, [min, max]: [number, number]): Set<number> {
  const out = new Set<number>();
  for (const part of src.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`"${part}" isn't a cron field`);
    const lo = m[1] === "*" ? min : Number(m[2]);
    const hi = m[1] === "*" ? max : m[3] != null ? Number(m[3]) : m[4] != null ? max : lo;
    const step = m[4] != null ? Number(m[4]) : 1;
    if (lo < min || hi > max || lo > hi || step < 1) throw new Error(`"${part}" is out of range ${min}-${max}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** Parse one expression. Throws with a readable message on anything malformed. */
export function parseCron(expr: string): Parsed {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`"${expr.trim()}" needs 5 fields, has ${parts.length}`);
  const sets = parts.map((p, i) => parseField(p, FIELDS[i]));
  if (sets[4].has(7)) sets[4].add(0);
  return { sets, domStar: parts[2] === "*", dowStar: parts[4] === "*" };
}

/** The expressions in a schedule: one per line, blank lines and `#` comments ignored. */
export function cronLines(text: string): string[] {
  return text.split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
}

export function cronMatches(p: Parsed, [min, hour, dom, mon, dow]: CronMoment): boolean {
  const [mins, hours, doms, mons, dows] = p.sets;
  if (!mins.has(min) || !hours.has(hour) || !mons.has(mon)) return false;
  if (p.domStar || p.dowStar) return doms.has(dom) && dows.has(dow);
  return doms.has(dom) || dows.has(dow);
}
