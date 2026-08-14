"use client";

import * as React from "react";
import Link from "next/link";
import { Menu } from "@base-ui/react/menu";
import { LogOut, Settings, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

/**
 * Where "sign out" goes now that Cloudflare Access owns the session.
 *
 * `/cdn-cgi/access/logout` is answered by the edge in front of the protected hostname, not
 * by this app — which is why every use of it is a plain `<a>` and not a `<Link>`: routing it
 * through the client router would look for a page that doesn't exist in the app. It only
 * exists in front of the deployed domain, so in local dev (and `pnpm preview`) it 404s.
 */
const SIGN_OUT_HREF = "/cdn-cgi/access/logout";

/** `location.hostname` spells the IPv6 loopback with its brackets. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** One row of the popup. Shared so the link and the sign-out sit on the same rhythm. */
const ITEM =
  "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-muted-foreground outline-none select-none data-highlighted:bg-pane-sunk data-highlighted:text-foreground";

/**
 * The account button: who you're signed in as, plus the two things you can do about it.
 *
 * It carries Settings and Sign out because it replaced the pair of bare icon buttons that
 * used to sit here. Two affordances that were only ever a gear and an arrow become one
 * button that can also say whose account they act on — and on a phone, where the gear was
 * hidden below `sm` for room, Settings becomes reachable again.
 *
 * The identity is read from Cloudflare Access in the browser rather than rendered from the
 * request headers, and that is the whole design. Access does put the email on every request
 * (`Cf-Access-Authenticated-User-Email`), but reading `headers()` in the root layout would
 * make every route in the app dynamic — `/recurring`, `/settings/appearance` and the two
 * redirect routes are still prerendered at build — and re-rendering the whole app per request
 * to print one address is a bad trade. PPR would give us a dynamic hole in a static shell; it
 * isn't enabled here.
 *
 * So the name arrives a beat after the page, once per full load: the answer is cached at
 * module scope, and the nav lives in the layout, so a client-side route change neither
 * remounts this nor refetches. The button itself never waits on that — it opens, and the
 * two actions work, whether or not the identity ever lands. Locally it never does.
 */
export function UserMenu() {
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

  // The IdP's name when it gave one, else the address's local part — "lam" reads as a
  // person, "lam@example.com" reads as a string. The full address sits under it.
  const label = identity ? identity.name || identity.email.split("@")[0] : null;

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="outline"
            size="icon"
            // The name is on the popup, not the button: a trigger that changes width when
            // the identity lands would shift the whole header cluster a beat after paint.
            aria-label={identity ? `Account — ${identity.email}` : "Account"}
            className="rounded-full bg-card text-muted-foreground data-popup-open:text-foreground"
          />
        }
      >
        <User className="size-4" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align="end" className="z-50 outline-none">
          <Menu.Popup className="min-w-[210px] origin-(--transform-origin) rounded-xl border border-border bg-card p-1.5 shadow-[0_12px_32px_rgb(0_0_0/0.18)] outline-none transition-[transform,opacity] duration-150 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
            {/* Not a `Menu.Item`: it is the menu's subject, not one of its actions, so it
                must not take focus or answer the arrow keys.

                Always drawn, even before — or without — an identity. A menu whose header
                appears only sometimes is one you can't trust to be telling you who you are,
                and the state it's missing in is the interesting one: on localhost there is
                no Access in front of the origin to ask, so it says so rather than leaving a
                gap you'd have to know the reason for. */}
            <div className="px-2.5 pt-1.5 pb-2.5">
              <div className="truncate text-[13px] font-semibold text-foreground">
                {label ?? "Local session"}
              </div>
              <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                {identity?.email ?? "No Access identity"}
              </div>
            </div>
            <Menu.Separator className="mx-1 my-1 h-px bg-divider" />
            <Menu.LinkItem className={ITEM} render={<Link href="/settings" />}>
              <Settings className="size-4 shrink-0" />
              Settings
            </Menu.LinkItem>
            <Menu.LinkItem
              className={cn(ITEM, "data-highlighted:text-destructive")}
              render={<a href={SIGN_OUT_HREF} />}
            >
              <LogOut className="size-4 shrink-0" />
              Sign out
            </Menu.LinkItem>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
