"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

/** Longest the bar stays up. A navigation that fails or is cancelled never changes the
 *  path, and the bar must not hang there for the rest of the visit. */
const GIVE_UP_MS = 15_000;

/**
 * A thin bar across the top from the click on a link to another page until that page is
 * shown. `app/loading.tsx` covers the page area, but only once the router has the
 * placeholder, which it only has at once if it preloaded the page; a click that beats the
 * preload showed nothing at all. This starts on the click itself.
 *
 * It listens for clicks rather than wrapping `Link`, so every internal link counts (the
 * nav, a goal's estimate link, a holding's transactions), and so does a link in the phone
 * drawer, which closes the moment it's tapped.
 */
export function NavProgress() {
  const pathname = usePathname();
  const [pendingFrom, setPendingFrom] = React.useState<string | null>(null);

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || a.target || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      // Another site, or this page again with a different query or hash: nothing loads
      // that a path change would ever end.
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      setPendingFrom(location.pathname);
    };
    // Capture: `Link` cancels the click's default (it navigates itself), so by the time a
    // click bubbles up to the document it looks like one that went nowhere.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Done once the path moves, by that click or any other way (Back, a redirect). Reset
  // during render, React's pattern for state that follows a changing value.
  const [shownPath, setShownPath] = React.useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setPendingFrom(null);
  }
  const pending = pendingFrom === pathname;
  React.useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPendingFrom(null), GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [pending]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-[100] h-0.5"
    >
      {pending && <div className="animate-nav-progress h-full origin-left bg-primary" />}
    </div>
  );
}
