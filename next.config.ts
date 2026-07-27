import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // No `output: "standalone"` and no `serverExternalPackages` any more: the Cloudflare
  // adapter produces its own Worker bundle, and better-sqlite3 (a native addon reading a
  // file off disk) is gone — see lib/db.ts.
  // Price sources moved under /settings; keep the old bookmark working.
  async redirects() {
    return [{ source: "/sources", destination: "/settings/price-sources", permanent: true }];
  },
};

// Makes the Cloudflare bindings declared in wrangler.jsonc (notably the D1 `DB` binding)
// available to `next dev`, so local development hits a real SQLite-backed D1 rather than
// failing on a missing binding.
initOpenNextCloudflareForDev();

export default nextConfig;
