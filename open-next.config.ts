import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext adapter config. Deliberately minimal: this app is entirely dynamic (every page
 * reads the database on each request), so there is no ISR/SSG cache worth wiring an R2
 * bucket up for. Add `incrementalCache` here if that ever changes.
 */
export default defineCloudflareConfig();
