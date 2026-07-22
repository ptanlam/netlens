"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

/**
 * The page name in the top bar, from the design file's `headerTitleStyle`.
 *
 * It's scroll-linked rather than a toggle: over the first 90px the label rises 26px and
 * fades from 0 to 1, opacity tracking the scroll position exactly while the transform is
 * smoothed by a 120ms linear transition. So it arrives as the page's own heading leaves,
 * with no snap at a threshold.
 *
 * Only side-rail mode shows it — the top bar names the page in its own nav pills already.
 * That gate is CSS (`html[data-nav="side"] [data-header-title]`), like the rail itself.
 */

/** Design: `scrollY / 90`, `translateY((1 - p) * 26px)`. */
const TRAVEL_PX = 90;
const RISE_PX = 26;

/** The label per route. Every page animates it in except the Dashboard, which the design
 *  pins (`scrollP = tab === 'Dashboard' ? 1 : …`) — it's the app's landing page and has no
 *  heading of its own, so the bar is the only thing naming it. Ordered longest-prefix
 *  first, since "/" would otherwise match everything. */
const ROUTES: { href: string; label: string; pinned?: boolean }[] = [
  { href: "/investments", label: "Investments" },
  { href: "/savings", label: "Savings" },
  { href: "/debts", label: "Debts" },
  { href: "/goals", label: "Goals" },
  { href: "/settings", label: "Settings" },
  { href: "/", label: "Dashboard", pinned: true },
];

export function HeaderPageTitle() {
  const pathname = usePathname();
  const route = ROUTES.find((r) => (r.href === "/" ? pathname === "/" : pathname.startsWith(r.href)));
  const pinned = route?.pinned ?? false;
  const ref = React.useRef<HTMLDivElement>(null);

  // Written straight to the node, like the nav's sliding pill: this is a scroll position,
  // and re-rendering the tree on every frame to carry it would be wasted work (and the
  // React Compiler's `set-state-in-effect` lint forbids the state version anyway).
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    const apply = () => {
      raf = 0;
      const p = pinned ? 1 : Math.min(1, Math.max(0, window.scrollY / TRAVEL_PX));
      el.style.opacity = String(p);
      // Reduced motion keeps the fade — it's the travel that's the problem.
      el.style.transform = still ? "" : `translateY(${((1 - p) * RISE_PX).toFixed(1)}px)`;
    };

    apply(); // before paint, so a pinned label doesn't flash in
    if (pinned) return;

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [pinned, pathname]);

  return (
    <div
      ref={ref}
      data-header-title
      // The heading it echoes is still in the document — a screen reader shouldn't hear
      // the page named twice — and it must never eat a click meant for the bar.
      aria-hidden
      className="pointer-events-none min-w-0 truncate text-[18px] font-bold tracking-[-0.015em] opacity-0 transition-transform duration-[120ms] ease-linear"
    >
      {route?.label}
    </div>
  );
}
