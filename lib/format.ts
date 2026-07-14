/** VND formatting shared by server and client. */

export function fmtVND(v: number): string {
  const neg = v < 0;
  const s = Math.abs(Math.round(v)).toLocaleString("de-DE");
  return `${neg ? "-" : ""}₫${s}`;
}

/** Group a run of digits with dots, as VND is written: "1000000" → "1.000.000".
 *  Non-digits are dropped and leading zeros collapsed, so it's safe to feed raw input. */
export function groupDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
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
