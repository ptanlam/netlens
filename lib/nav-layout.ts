/** Sidebar preferences.
 *
 *  There used to be a choice here — the design's side rail, or a top bar carrying the links
 *  across the header. The top bar is gone: below the rail's breakpoint it was the *only*
 *  layout either setting produced, and on a phone it had to hold a drawer trigger, the
 *  wordmark, the price controls, a theme toggle and the account button on one 70px row.
 *  What is left is the rail, and the drawer it becomes on a narrow screen — one navigation
 *  surface at every width instead of two that had to be kept in step.
 *
 *  The width of that rail is still a preference. Device-local like the theme — it's about
 *  this screen, not about the data, so it lives in localStorage and never touches the DB.
 *  It's mirrored onto <html> as `data-nav-collapsed`, because the rail is CSS
 *  (`app/globals.css`): the header renders once and the rail is a sibling, which is what
 *  keeps the app's single price poller from being mounted twice. An inline script in
 *  `app/layout.tsx` stamps it before first paint, so a collapsed rail never flashes open.
 */

import * as React from "react";

export const NAV_COLLAPSED_KEY = "pf.nav-collapsed";

/** The snippet that runs before paint. Kept next to the readers so the key and the
 *  fallback can't drift apart. */
export const NAV_PREF_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(
  NAV_COLLAPSED_KEY,
)})==='1')document.documentElement.dataset.navCollapsed='1'}catch(e){}`;

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

function readCollapsed(): boolean {
  return document.documentElement.dataset.navCollapsed === "1";
}

export function setNavCollapsed(next: boolean) {
  const d = document.documentElement;
  if (next) d.dataset.navCollapsed = "1";
  else delete d.dataset.navCollapsed;
  try {
    if (next) window.localStorage.setItem(NAV_COLLAPSED_KEY, "1");
    else window.localStorage.removeItem(NAV_COLLAPSED_KEY);
  } catch {
    // Private mode / storage disabled: the choice still applies for this page.
  }
  for (const cb of listeners) cb();
}

export function toggleNavCollapsed() {
  setNavCollapsed(!readCollapsed());
}

/** Whether the rail is showing icons only. Server (and the first client pass) always sees
 *  the expanded default — the pre-paint script has already applied the real value to the
 *  DOM, so this only ever drives labels, never the choice of markup. */
export function useNavCollapsed(): boolean {
  return React.useSyncExternalStore(subscribe, readCollapsed, () => false);
}
