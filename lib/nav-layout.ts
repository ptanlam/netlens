/** Where the chrome sits: the default top bar, or the side rail from the design file
 *  ("Netlens Dashboard.dc.html").
 *
 *  Device-local like the theme — it's a preference about this screen, not about the data,
 *  so it lives in localStorage and never touches the DB. Both flags are mirrored onto
 *  <html> as `data-nav` / `data-nav-collapsed`, because the rail itself is CSS
 *  (`app/globals.css`): the header renders once and the rail is a sibling that CSS shows
 *  or hides, so <LivePrices> — the app's only price poller — is never mounted twice.
 *  An inline script in `app/layout.tsx` stamps both before first paint, which is what
 *  keeps the rail from flashing in as a top bar on every load.
 */

import * as React from "react";

export const NAV_LAYOUT_KEY = "pf.nav-layout";
export const NAV_COLLAPSED_KEY = "pf.nav-collapsed";

export const NAV_LAYOUTS = [
  { value: "top", label: "Top bar", hint: "Links across the header" },
  { value: "side", label: "Side rail", hint: "Links down the left edge" },
] as const;

export type NavLayout = (typeof NAV_LAYOUTS)[number]["value"];

export function isNavLayout(v: unknown): v is NavLayout {
  return NAV_LAYOUTS.some((l) => l.value === v);
}

/** The snippet that runs before paint. Kept next to the readers so the keys and the
 *  fallbacks can't drift apart. */
export const NAV_LAYOUT_SCRIPT = `try{var d=document.documentElement,s=localStorage;d.dataset.nav=s.getItem(${JSON.stringify(
  NAV_LAYOUT_KEY,
)})==='side'?'side':'top';if(s.getItem(${JSON.stringify(
  NAV_COLLAPSED_KEY,
)})==='1')d.dataset.navCollapsed='1'}catch(e){document.documentElement.dataset.nav='top'}`;

// Same tiny-store shape as the auto-refresh setting in `components/live-prices.tsx`:
// useSyncExternalStore keeps the SSR snapshot from desyncing against the saved value, and
// the `storage` event keeps two open tabs in step.
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function save(key: string, value: string | null) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode / storage disabled: the choice still applies for this page.
  }
  for (const cb of listeners) cb();
}

function readLayout(): NavLayout {
  const v = document.documentElement.dataset.nav;
  return isNavLayout(v) ? v : "top";
}

function readCollapsed(): boolean {
  return document.documentElement.dataset.navCollapsed === "1";
}

export function setNavLayout(v: NavLayout) {
  document.documentElement.dataset.nav = v;
  save(NAV_LAYOUT_KEY, v);
}

export function toggleNavCollapsed() {
  const next = !readCollapsed();
  const d = document.documentElement;
  if (next) d.dataset.navCollapsed = "1";
  else delete d.dataset.navCollapsed;
  save(NAV_COLLAPSED_KEY, next ? "1" : null);
}

/** The current layout. Server (and the first client pass) always sees "top" — the
 *  pre-paint script has already applied the real one to the DOM, so this only ever drives
 *  behaviour and labels, never the choice of markup. */
export function useNavLayout(): NavLayout {
  return React.useSyncExternalStore(subscribe, readLayout, () => "top" as const);
}
