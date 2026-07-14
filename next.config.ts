import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  // Price sources moved under /settings; keep the old bookmark working.
  async redirects() {
    return [{ source: "/sources", destination: "/settings/price-sources", permanent: true }];
  },
};

export default nextConfig;
