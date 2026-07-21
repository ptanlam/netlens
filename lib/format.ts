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

/** A holding's unit count. Never interpolate `quantity` straight into a template: it's a
 *  running total in doubles, so a value that should read 1264,35 can carry representation
 *  noise out to 17 significant digits. Trailing zeros are dropped, so whole share counts
 *  still read "2.000" rather than "2.000,00000000". */
export function fmtUnits(v: number): string {
  return v.toLocaleString("de-DE", { maximumFractionDigits: 8 });
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
