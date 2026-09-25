/** "Hide amounts" — the design's eye toggle.
 *
 *  Device-local like the theme and the rail width: it's about who can see this screen, not
 *  about the data, so it lives in localStorage and never touches the DB. It's mirrored onto
 *  <html> as `data-mask`, and the masking itself is pure CSS (`app/globals.css`), keyed off
 *  the classes every figure already carries. That means server components, client charts
 *  and the tooltips a chart library builds in JS all hide together, without threading a
 *  flag through every formatter. An inline script in `app/layout.tsx` stamps it before
 *  first paint, so with the mask on the real figures never flash up on load.
 */

import * as React from "react";

export const MASK_KEY = "pf.mask-amounts";

export const MASK_PREF_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(
  MASK_KEY,
)})==='1')document.documentElement.dataset.mask='1'}catch(e){}`;

// Same tiny-store shape as `lib/nav-layout.ts`: the `storage` event keeps two open tabs in
// step, so hiding amounts in one hides them in the other.
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== MASK_KEY) return;
    apply(e.newValue === "1");
    cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function readMasked(): boolean {
  return document.documentElement.dataset.mask === "1";
}

function apply(next: boolean) {
  const d = document.documentElement;
  if (next) d.dataset.mask = "1";
  else delete d.dataset.mask;
}

export function setMasked(next: boolean) {
  apply(next);
  try {
    if (next) window.localStorage.setItem(MASK_KEY, "1");
    else window.localStorage.removeItem(MASK_KEY);
  } catch {
    // Private mode / storage disabled: the choice still applies for this page.
  }
  for (const cb of listeners) cb();
}

/** Server and the first client pass see "shown"; the pre-paint script has already applied
 *  the real value to the DOM, so this only drives the button's icon and label. */
export function useMasked(): boolean {
  return React.useSyncExternalStore(subscribe, readMasked, () => false);
}
