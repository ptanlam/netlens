/** VND formatting shared by server and client. */

export function fmtVND(v: number): string {
  const neg = v < 0;
  const s = Math.abs(Math.round(v)).toLocaleString("de-DE");
  return `${neg ? "-" : ""}₫${s}`;
}

/** Axis-style short form: 40tr = 40 million VND. */
export function fmtTr(v: number): string {
  if (v === 0) return "0";
  return `${Math.round(v / 1e6)}tr`;
}

export const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
