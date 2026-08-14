"use client";

import * as React from "react";
import { ArrowDown, RefreshCw } from "lucide-react";
import { useRefreshPrices } from "@/components/live-prices";
import { cn } from "@/lib/utils";

/** Finger travel before a release counts as a pull. Long enough that a flick at the top of
 *  a list doesn't fire it, short enough to reach with a thumb. */
const THRESHOLD = 72;
/** Furthest the indicator travels, however hard you pull. */
const MAX = 108;
/** Finger travel → indicator travel. The gap is the drag that tells you it's a gesture and
 *  not a scroll — a 1:1 indicator feels weightless and fires by accident. */
const RESIST = 0.5;

/** Anything with its own scrollbar that isn't scrolled to the top owns this gesture — the
 *  paged transaction list, a horizontally-scrolling table, the body of a dialog. */
function insideScrolledRegion(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null;
  for (; el && el !== document.body; el = el.parentElement) {
    if (el.scrollTop > 0) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") return true;
    }
  }
  return false;
}

/** A dialog, select or menu is open, so the page behind it isn't what the finger is on. */
function popupOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"], [role="listbox"], [role="menu"]'));
}

/**
 * Pull down at the top of the page to refresh — the phone gesture, since the app is used
 * as a home-screen PWA where there is no browser reload button to reach for.
 *
 * Touch-only by construction: it listens for touch events, so a mouse never reaches it and
 * there is nothing to gate on a media query.
 *
 * The indicator is written straight to the element's style during the drag rather than
 * held in state. A pull fires `touchmove` at screen refresh rate and re-rendering the tree
 * on each one is both wasteful and visibly behind the finger; React state is kept for the
 * three things that actually change what's drawn (below the threshold, past it, running).
 * The same reasoning as the nav's sliding highlight, which is also a measurement.
 *
 * `touchmove` is bound non-passively because the whole point is to `preventDefault` the
 * browser's own overscroll while the gesture is live. Chrome's native pull-to-refresh is
 * kept out of the way by `overscroll-behavior-y: contain` on the body — without it, its
 * gesture and this one fire together.
 */
export function PullToRefresh() {
  const { run } = useRefreshPrices();
  const barRef = React.useRef<HTMLDivElement>(null);
  const startY = React.useRef(0);
  const startX = React.useRef(0);
  const tracking = React.useRef(false);
  const pulled = React.useRef(0);
  const [phase, setPhase] = React.useState<"idle" | "pull" | "ready" | "busy">("idle");
  // Read by the listeners, which are bound once and would otherwise close over a stale
  // `phase` for the life of the page.
  const phaseRef = React.useRef(phase);
  React.useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const draw = React.useCallback((offset: number, animate: boolean) => {
    const bar = barRef.current;
    if (!bar) return;
    bar.style.transition = animate ? "transform 0.22s ease, opacity 0.22s ease" : "none";
    bar.style.transform = `translate3d(-50%, ${offset}px, 0)`;
    bar.style.opacity = offset > 4 ? "1" : "0";
  }, []);

  React.useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (phaseRef.current === "busy" || e.touches.length !== 1) return;
      // Only from a standing start at the very top, and never over something that scrolls
      // on its own or under an open popup.
      if (window.scrollY > 0 || popupOpen() || insideScrolledRegion(e.target)) return;
      tracking.current = true;
      startY.current = e.touches[0].clientY;
      startX.current = e.touches[0].clientX;
      pulled.current = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking.current) return;
      const dy = e.touches[0].clientY - startY.current;
      const dx = e.touches[0].clientX - startX.current;
      // Upward, or more sideways than down: not our gesture. Let go of it for good rather
      // than re-arming mid-swipe, or a diagonal scroll keeps snagging.
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
        tracking.current = false;
        draw(0, true);
        setPhase("idle");
        return;
      }
      // Cancelable is false once the browser has committed the touch to scrolling; calling
      // preventDefault then only earns a console warning.
      if (e.cancelable) e.preventDefault();
      pulled.current = Math.min(dy * RESIST, MAX);
      draw(pulled.current, false);
      setPhase(pulled.current >= THRESHOLD ? "ready" : "pull");
    };

    const onEnd = () => {
      if (!tracking.current) return;
      tracking.current = false;
      if (pulled.current < THRESHOLD) {
        draw(0, true);
        setPhase("idle");
        return;
      }
      // Held at the threshold while it runs, so the spinner has somewhere to sit.
      setPhase("busy");
      draw(THRESHOLD, true);
      void run({ force: true }).finally(() => {
        draw(0, true);
        setPhase("idle");
      });
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [draw, run]);

  const busy = phase === "busy";
  const ready = phase === "ready";

  return (
    <div
      ref={barRef}
      aria-hidden={phase === "idle"}
      role="status"
      aria-live="polite"
      // Above the sticky header (z-40) so it reads as coming from the top edge of the app,
      // but under the drawer (z-50), which covers the page entirely when it's out.
      className="pointer-events-none fixed top-[calc(0.5rem+env(safe-area-inset-top))] left-1/2 z-[45] grid size-9 place-items-center rounded-full border border-input bg-card opacity-0 shadow-[0_2px_10px_rgb(0_0_0/0.16)]"
      style={{ transform: "translate3d(-50%, 0, 0)" }}
    >
      <span className="sr-only">{busy ? "Refreshing" : ready ? "Release to refresh" : "Pull to refresh"}</span>
      {busy ? (
        <RefreshCw className="size-4 animate-spin text-accent-brand" />
      ) : (
        <ArrowDown
          className={cn(
            "size-4 transition-[transform,color] duration-200",
            ready ? "rotate-180 text-accent-brand" : "text-muted-foreground",
          )}
        />
      )}
    </div>
  );
}
