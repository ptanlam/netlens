import { createHash } from "crypto";

export const COOKIE_NAME = "inv_auth";

/** Deterministic token derived from the password — survives restarts. */
export function authToken(password: string): string {
  return createHash("sha256").update(`investment-viz::${password}`).digest("hex");
}
