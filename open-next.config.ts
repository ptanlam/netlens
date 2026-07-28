import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext adapter config. Deliberately minimal: this app is entirely dynamic (every page
 * reads the database on each request), so there is no ISR/SSG cache worth wiring an R2
 * bucket up for. Add `incrementalCache` here if that ever changes.
 *
 * `buildCommand` is load-bearing. To produce the Next.js output it shells out to the
 * package manager's `build` script by default — but ours is `opennextjs-cloudflare build`,
 * which would re-enter this very command and fork forever. Point it at `build:next`
 * (plain `next build`) so the chain terminates. `defineCloudflareConfig` only takes the
 * Cloudflare overrides, so the field is spread onto its result.
 */
const config = {
  ...defineCloudflareConfig(),
  buildCommand: "pnpm build:next",
};

export default config;
