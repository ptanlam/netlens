"use client";

import * as React from "react";

/** What `/cdn-cgi/access/get-identity` gives us, narrowed to the two fields worth showing. */
interface Identity {
  email: string;
  /** From the identity provider. Absent on a one-time-PIN login, which is why the email
   *  is the fallback rather than the other way round. */
  name?: string;
}

/**
 * Held at module scope, not in `sessionStorage`: it survives a remount without a second
 * request, and reading it in a `useState` initializer is safe on both sides of hydration —
 * it starts null in a fresh page load, so the server's HTML and the client's first render
 * agree. (A `sessionStorage` read would disagree with the server on the second page load,
 * and setting it from an effect trips `react-hooks/set-state-in-effect`.)
 */
let cached: Identity | null = null;

/** `location.hostname` spells the IPv6 loopback with its brackets. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Who you're signed in as, read from Cloudflare Access.
 *
 * Fetched in the browser rather than rendered from the request headers, and that is the
 * whole design. Access does put the email on every request (`Cf-Access-Authenticated-User-Email`),
 * but reading `headers()` in the root layout would make every route in the app dynamic —
 * `/recurring`, `/settings/appearance` and the two redirect routes are still prerendered at
 * build — and re-rendering the whole app per request to print one address is a bad trade.
 * PPR would give us a dynamic hole in a static shell; it isn't enabled here.
 *
 * The cost is that the chip appears a beat after the page — once per full load, since the
 * answer is cached below and the nav lives in the layout, so a client-side route change
 * neither remounts this nor refetches.
 *
 * Renders nothing when there's no identity to show — which is every local `pnpm dev` and
 * `pnpm preview`, where nothing sits in front of the app and the endpoint 400s.
 */
export function AccessUser() {
  const [identity, setIdentity] = React.useState<Identity | null>(cached);

  React.useEffect(() => {
    if (cached) return;
    // Nothing sits in front of a loopback origin, so the request could only 404 — and the
    // browser logs that before our `.catch` ever sees it, which would put a permanent red
    // line in the console of every local page load and devalue the "no console errors"
    // check the visual workflow depends on. Checked on the hostname rather than NODE_ENV so
    // `pnpm preview` (a production build, still on localhost) stays quiet too.
    if (LOOPBACK.has(location.hostname)) return;
    let live = true;
    // `same-origin` because the whole point is the CF_Authorization cookie; the endpoint is
    // answered by the edge in front of this hostname, never by the app.
    fetch("/cdn-cgi/access/get-identity", { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<Identity>) : null))
      .then((data) => {
        if (!data?.email) return;
        cached = { email: data.email, name: data.name };
        if (live) setIdentity(cached);
      })
      // A failure here is not worth a toast or a console line: signed out is the one state
      // this component cannot be in (Access wouldn't have served the page), so anything that
      // goes wrong is local dev, and the answer is the same — draw nothing.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!identity) return null;

  // The local part, not the whole address: "lam" beside a nav is a name, while
  // "lam@example.com" is a string long enough to push the price controls around. The full
  // address stays one hover away.
  const label = identity.name || identity.email.split("@")[0];

  return (
    <span
      title={identity.email}
      className="hidden h-7 shrink-0 items-center gap-2 rounded-full border border-input bg-card pr-3 pl-[3px] sm:flex"
    >
      <span
        aria-hidden
        className="grid size-[22px] shrink-0 place-items-center rounded-full bg-pane-sunk text-[10px] font-bold text-muted-foreground"
      >
        {label.charAt(0).toUpperCase()}
      </span>
      <span className="max-w-[10ch] truncate text-[12px] font-semibold text-muted-foreground">
        {label}
      </span>
    </span>
  );
}
