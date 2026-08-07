/**
 * Brand marks for holdings — the real logo behind a row's avatar.
 *
 * The tinted letter tile in `EntityAvatar` is the fallback, not the goal: anything we
 * hold a mark for shows the mark. Files are bundled under `public/logos/` rather than
 * hotlinked from the issuers — their own files are 100 KB–3 MB press assets, and a
 * column of 24px avatars must not cost megabytes or go blank when someone else's CDN
 * does. Each is cropped to the *symbol* (not the wordmark, which is a smudge at this
 * size), trimmed, and letterboxed into a 96px square: 3x the largest avatar.
 *
 * To add one: put a square PNG in `public/logos/` and add a line below, keyed by the
 * holding's name or its symbol — whichever is stable. Keys are normalised (upper case,
 * exchange/quote suffix dropped), so `SSI` covers both `SSI` and `SSI.VN`.
 */
const LOGOS: Record<string, string> = {
  // HOSE-listed
  ACB: "acb",
  FPT: "fpt",
  HPG: "hpg",
  MBB: "mbb",
  SSI: "ssi",
  VIC: "vic",
  // Funds — the manager's mark, which is what the fund is known by
  DCDS: "dcds",
  "VCBF-TBF": "vcbf-tbf",
  // Crypto — keyed by CoinGecko id as well as ticker
  BITCOIN: "bitcoin",
  BTC: "bitcoin",
};

/** `SSI.VN` → `SSI`, `btc-usd` → `BTC`: drop the venue/quote a feed's symbol carries. */
function normalize(key: string): string {
  return key.trim().toUpperCase().replace(/\.[A-Z]{2,4}$/, "").replace(/-(USD|USDT|VND)$/, "");
}

/**
 * The logo URL for a holding, or `undefined` when we don't have one (leaving the
 * letter tile). Pass every identifier the caller has — name first, then symbol; the
 * first that matches wins.
 */
export function holdingLogo(...keys: (string | null | undefined)[]): string | undefined {
  for (const key of keys) {
    if (!key) continue;
    const slug = LOGOS[normalize(key)];
    if (slug) return `/logos/${slug}.png`;
  }
  return undefined;
}
