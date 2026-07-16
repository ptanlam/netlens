/**
 * Some upstream price feeds (e.g. dragoncapital.com.vn) serve an INCOMPLETE TLS
 * chain — the leaf only, without the intermediate CA cert. Browsers and curl
 * silently fetch the missing intermediate (via the cert's AIA URL); Node's fetch
 * (undici) does not, and rejects the connection with UNABLE_TO_VERIFY_LEAF_SIGNATURE.
 *
 * Fix: trust the missing intermediates ourselves. Every PEM in `certs/` is added
 * to Node's default root set, so the chain can be built. This does NOT disable
 * verification — each intermediate is itself signed by a bundled public root, so
 * the leaf is still fully validated. Drop-in for new feeds: add the intermediate
 * PEM to `certs/` (grab it from the cert's "CA Issuers" AIA URL) — no code change.
 */
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { Agent, setGlobalDispatcher } from "undici";

let installed = false;

/** Install a global undici dispatcher that trusts `certs/*.pem` in addition to the
 *  built-in roots. Idempotent and best-effort — a missing/empty dir is a no-op. */
export function installExtraCAs(): void {
  if (installed) return;
  installed = true;
  try {
    const dir = path.join(process.cwd(), "certs");
    const pems = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".pem") || f.endsWith(".crt"))
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
    if (!pems.length) return;
    setGlobalDispatcher(new Agent({ connect: { ca: [...tls.rootCertificates, ...pems] } }));
  } catch {
    // No certs dir, or not a Node runtime — leave the default dispatcher in place.
  }
}
