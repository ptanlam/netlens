'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import {
  Menu, LogOut, Settings, ChevronsLeft,
  LayoutDashboard, TrendingUp, PiggyBank, CreditCard, Target,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconTooltip } from '@/components/ui/tooltip';
import { LivePrices } from '@/components/live-prices';
import { HeaderPageTitle } from '@/components/header-page-title';
import { logout } from '@/app/actions';
import { toggleNavCollapsed } from '@/lib/nav-layout';
import { cn } from '@/lib/utils';

// Settings isn't here: it's the gear in the right-hand cluster (and a row in the drawer,
// which is where the gear can't fit).
const LINKS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/investments', label: 'Investments', icon: TrendingUp },
  { href: '/savings', label: 'Savings', icon: PiggyBank },
  { href: '/debts', label: 'Debts', icon: CreditCard },
  { href: '/goals', label: 'Goals', icon: Target },
];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

function Wordmark() {
  return (
    // Below 360px even the slimmed-down price controls leave no room for the mark; the
    // drawer trigger and its title carry the brand there, so hide the lot rather than
    // let the label get squeezed off and strand a bare square.
    <Link
      href='/'
      className='hidden shrink-0 items-center gap-2.5 text-foreground min-[360px]:flex'
      aria-label='Netlens — home'
    >
      {/* The mark is the only place the brand violet gets to glow — it's what fixes the
          accent in the eye before any chart uses it. */}
      <span className='size-[13px] shrink-0 rounded-[5px] bg-brand shadow-[0_0_18px_var(--brand)]' />
      <span className='text-[17px] font-bold whitespace-nowrap tracking-[-0.01em]'>Netlens</span>
    </Link>
  );
}

function NavPill({
  href,
  label,
  icon: Icon,
  pathname,
  onClick,
  /** 'slide' leaves the active background to <DesktopNav>'s shared slider; 'solid' paints
   *  it on the pill itself (the drawer, where there's nothing to slide). */
  variant = 'solid',
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  pathname: string;
  onClick?: () => void;
  variant?: 'solid' | 'slide';
}) {
  const active = isActive(pathname, href);
  return (
    <Link
      href={href}
      onClick={onClick}
      data-active={active}
      className={cn(
        'relative z-10 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] whitespace-nowrap transition-colors',
        active
          ? cn('font-semibold text-foreground', variant === 'solid' && 'bg-brand-soft ring-1 ring-input ring-inset')
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      <Icon className='size-3.5 shrink-0' />
      {label}
    </Link>
  );
}

/**
 * The desktop links, with a single highlight that slides from the old page's pill to the
 * new one instead of blinking between them.
 *
 * The slider is positioned by writing to its style directly rather than through state:
 * this is a layout measurement, and `react-hooks/set-state-in-effect` (React Compiler)
 * forbids the setState-in-effect version. It's also re-measured on resize, since the pill
 * offsets move with the container.
 */
function DesktopNav({ pathname }: { pathname: string }) {
  const navRef = React.useRef<HTMLElement>(null);
  const sliderRef = React.useRef<HTMLSpanElement>(null);
  const placed = React.useRef(false);

  React.useLayoutEffect(() => {
    const nav = navRef.current;
    const slider = sliderRef.current;
    if (!nav || !slider) return;

    const place = () => {
      const active = nav.querySelector<HTMLElement>('[data-active="true"]');
      if (!active) {
        slider.style.opacity = '0';
        return;
      }
      const apply = () => {
        slider.style.opacity = '1';
        slider.style.left = `${active.offsetLeft}px`;
        slider.style.width = `${active.offsetWidth}px`;
      };
      // On the very first placement there's nothing to slide *from* — animating would
      // fly the pill in from the left edge on every fresh page load.
      if (placed.current) {
        apply();
      } else {
        slider.style.transition = 'none';
        apply();
        void slider.offsetWidth; // flush, so the transition we restore isn't retroactive
        slider.style.transition = '';
        placed.current = true;
      }
    };

    place();

    const ro = new ResizeObserver(place);
    ro.observe(nav);
    // Every pill is measured, so anything that changes their width has to re-place the
    // slider — and the web font lands *after* first paint, widening each label. Without
    // this the slider can stay frozen at the icon-only width it measured pre-font, leaving
    // the tail of the active label hanging outside its own highlight.
    let live = true;
    document.fonts?.ready.then(() => {
      if (live) place();
    });

    return () => {
      live = false;
      ro.disconnect();
    };
  }, [pathname]);

  return (
    <nav ref={navRef} data-desktop-nav className='relative hidden items-center gap-0.5 lg:flex'>
      {/* Animates `left`/`width`, not `transform`: a transformed layer whose width changes
          doesn't reliably re-rasterize, so the pill paints at its stale width. The nav is
          five items — laying them out is cheap, and it always paints what it measured. */}
      <span
        ref={sliderRef}
        aria-hidden
        className='absolute inset-y-0 left-0 z-0 w-0 rounded-full bg-brand-soft opacity-0 ring-1 ring-input ring-inset transition-[left,width,opacity] duration-300 ease-out motion-reduce:transition-none'
      />
      {LINKS.map((l) => (
        <NavPill
          key={l.href}
          href={l.href}
          label={l.label}
          icon={l.icon}
          pathname={pathname}
          variant='slide'
        />
      ))}
    </nav>
  );
}

// Left-edge swipe to open the drawer, swipe-left to close it — the phone gesture the
// hamburger stands in for. `start` must land within EDGE px of the screen's left edge,
// then travel DISTANCE px sideways while drifting less than SLOP vertically (so a diagonal
// scroll doesn't trip it). Only meaningful in the mobile layout; the drawer doesn't exist
// from lg up, so the open-gesture bails there. Refs, not state, so tracking a drag never
// re-renders. In a standalone PWA the left edge is ours — iOS only reserves it for
// back-swipe inside a Safari tab.
const EDGE_PX = 28;
const SWIPE_DISTANCE = 60;
const SWIPE_SLOP = 40;

function MobileNav({ pathname }: { pathname: string }) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const lg = window.matchMedia('(min-width: 1024px)');
    let fromEdge = false;
    let startX = 0;
    let startY = 0;

    const onStart = (e: TouchEvent) => {
      if (lg.matches || open) return;
      const t = e.touches[0];
      fromEdge = t.clientX <= EDGE_PX;
      startX = t.clientX;
      startY = t.clientY;
    };
    const onEnd = (e: TouchEvent) => {
      if (!fromEdge) return;
      fromEdge = false;
      const t = e.changedTouches[0];
      if (t.clientX - startX > SWIPE_DISTANCE && Math.abs(t.clientY - startY) < SWIPE_SLOP) {
        setOpen(true);
      }
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
    };
  }, [open]);

  // Swipe left on the open drawer to dismiss it.
  const closeStart = React.useRef<{ x: number; y: number } | null>(null);
  const onPopupTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    closeStart.current = { x: t.clientX, y: t.clientY };
  };
  const onPopupTouchEnd = (e: React.TouchEvent) => {
    const s = closeStart.current;
    closeStart.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    if (s.x - t.clientX > SWIPE_DISTANCE && Math.abs(t.clientY - s.y) < SWIPE_SLOP) {
      setOpen(false);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <IconTooltip label='Open menu'>
        <DialogPrimitive.Trigger render={<Button variant='ghost' size='icon' aria-label='Open menu' className='rounded-full' />}>
          <Menu className='size-5' />
        </DialogPrimitive.Trigger>
      </IconTooltip>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className='fixed inset-0 z-50 bg-black/40 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0' />
        <DialogPrimitive.Popup
          onTouchStart={onPopupTouchStart}
          onTouchEnd={onPopupTouchEnd}
          className='fixed inset-y-0 left-0 z-50 flex w-64 max-w-[80%] flex-col gap-1 bg-card p-4 ring-1 ring-border duration-150 outline-none data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left'>
          <DialogPrimitive.Title className='mb-2 flex items-center gap-2.5 px-1.5'>
            <span className='size-[13px] rounded-[5px] bg-brand shadow-[0_0_18px_var(--brand)]' />
            <span className='text-base font-bold tracking-tight'>Netlens</span>
          </DialogPrimitive.Title>
          <nav className='flex flex-col gap-1'>
            {LINKS.map((l) => (
              <NavPill key={l.href} href={l.href} label={l.label} icon={l.icon} pathname={pathname} onClick={() => setOpen(false)} />
            ))}
          </nav>
          {/* The header row has no width for the gear on a phone, so settings — theme
              included — is reached from here instead. */}
          <div className='mt-auto border-t border-border pt-3 sm:hidden'>
            <Link
              href='/settings'
              onClick={() => setOpen(false)}
              className={cn(
                'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] transition-colors',
                isActive(pathname, '/settings')
                  ? 'bg-brand-soft font-semibold text-foreground ring-1 ring-input ring-inset'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              <Settings className='size-3.5' />
              Settings
            </Link>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function LogoutButton() {
  return (
    <form action={logout}>
      <IconTooltip label='Sign out'>
        <Button variant='ghost' size='icon' type='submit' aria-label='Sign out' className='rounded-full'>
          <LogOut className='size-4' />
        </Button>
      </IconTooltip>
    </form>
  );
}

/** One row of the side rail: same shape for the five sections and for Settings. The label
 *  is a sibling of the icon rather than plain text so the collapsed rail can drop it in
 *  CSS — collapsing must not change the markup, or it couldn't be applied before paint. */
function RailLink({
  href,
  label,
  icon: Icon,
  pathname,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  pathname: string;
}) {
  return (
    <Link
      href={href}
      data-active={isActive(pathname, href)}
      title={label}
      className='flex items-center gap-3 rounded-xl border border-transparent px-3.5 py-2.5 text-[13.5px] font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground data-[active=true]:border-input data-[active=true]:bg-brand-soft data-[active=true]:text-foreground'
    >
      <Icon className='size-[17px] shrink-0' />
      <span data-rail-label className='min-w-0 truncate'>{label}</span>
    </Link>
  );
}

/**
 * The side rail from the design file. It's rendered on every page and revealed by CSS
 * (`html[data-nav="side"]`) rather than by a client branch: the preference is applied
 * before paint, and keeping the markup constant is what lets that work without a
 * hydration mismatch. It costs a handful of static links — the price poller stays in the
 * header, mounted once.
 */
function SideRail({ pathname, authEnabled }: { pathname: string; authEnabled: boolean }) {
  return (
    <aside data-side-rail>
      <div data-rail-brand>
        <Link href='/' className='flex min-w-0 items-center gap-2.5 text-foreground' aria-label='Netlens — home'>
          <span className='size-[15px] shrink-0 rounded-[5px] bg-brand shadow-[0_0_18px_var(--brand)]' />
          <span data-rail-label className='truncate text-[18px] font-bold tracking-[-0.01em]'>Netlens</span>
        </Link>
        <button
          type='button'
          onClick={toggleNavCollapsed}
          aria-label='Toggle sidebar width'
          title='Toggle sidebar width'
          className='grid size-[30px] shrink-0 place-items-center rounded-[9px] border border-border text-muted-foreground transition-colors hover:border-brand hover:text-foreground'
        >
          {/* Points the other way when collapsed — a CSS rotation, so the button doesn't
              have to know the state React can't see on the server. */}
          <ChevronsLeft data-rail-chevron className='size-4' />
        </button>
      </div>

      <nav data-rail-nav>
        {LINKS.map((l) => (
          <RailLink key={l.href} href={l.href} label={l.label} icon={l.icon} pathname={pathname} />
        ))}
      </nav>

      <div data-rail-foot>
        <RailLink href='/settings' label='Settings' icon={Settings} pathname={pathname} />
        {authEnabled && (
          <form action={logout} data-rail-signout>
            <button
              type='submit'
              aria-label='Sign out'
              title='Sign out'
              className='grid h-[38px] w-full place-items-center rounded-[11px] border border-border text-muted-foreground transition-colors hover:border-destructive hover:text-destructive'
            >
              <LogOut className='size-4' />
            </button>
          </form>
        )}
      </div>
    </aside>
  );
}

export function Nav({ authEnabled = false }: { authEnabled?: boolean }) {
  const pathname = usePathname();
  if (pathname === '/login') return null;
  return (
    <>
      <SideRail pathname={pathname} authEnabled={authEnabled} />
      <header data-app-header className='sticky top-0 z-40 border-b border-border bg-(--header-bg) pt-[env(safe-area-inset-top)] backdrop-blur-[24px] backdrop-saturate-150'>
        {/* Must track <main>'s max-width in app/layout.tsx, or the header sits narrower
            than the content beneath it. The left/right padding also clears the safe areas:
            the iPhone notch in landscape and, on iPadOS 26, the window-control traffic
            lights overlaid on the top-left of a windowed/split web app — without this they
            sit on top of the drawer's hamburger. */}
        <div data-app-header-inner className='mx-auto flex h-[64px] w-full max-w-[1180px] items-center justify-between gap-3 pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] sm:pl-[max(2rem,env(safe-area-inset-left))] sm:pr-[max(2rem,env(safe-area-inset-right))] xl:max-w-[1400px] 2xl:max-w-[1640px]'>
          {/* The pills only clear the price controls from ~1024px up; below that they
              collide with them, so the drawer holds the links until lg. With the rail on,
              this whole group is the rail's job and CSS hides it. */}
          {/* display:none outside side-rail mode, so it never disturbs the top bar's own
              spacing. */}
          <HeaderPageTitle />
          <div data-nav-brand className='flex min-w-0 items-center gap-3 lg:gap-7'>
            <div className='lg:hidden'>
              <MobileNav pathname={pathname} />
            </div>
            <Wordmark />
            <DesktopNav pathname={pathname} />
          </div>
          <div className='flex shrink-0 items-center gap-2'>
            <LivePrices />
            <div data-nav-icons className='flex items-center gap-2'>
              <IconTooltip label='Settings'>
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label='Settings'
                  nativeButton={false}
                  className='hidden rounded-full sm:inline-flex'
                  render={<Link href='/settings' />}
                >
                  <Settings className='size-4' />
                </Button>
              </IconTooltip>
              {authEnabled && <LogoutButton />}
            </div>
          </div>
        </div>
      </header>
    </>
  );
}
