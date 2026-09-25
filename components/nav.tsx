'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import {
  Menu, Settings, ChevronsLeft,
  LayoutDashboard, TrendingUp, ArrowLeftRight, PiggyBank, CreditCard, CalendarSync, Target, LineChart,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconTooltip } from '@/components/ui/tooltip';
import { UserMenu } from '@/components/user-menu';
import { LivePrices, PricePoller } from '@/components/live-prices';
import { HeaderSearch } from '@/components/header-search';
import { ThemeToggle } from '@/components/theme-toggle';
import { MaskToggle } from '@/components/mask-toggle';
import { toggleNavCollapsed } from '@/lib/nav-layout';
import { cn } from '@/lib/utils';

// Settings isn't here: it's a row in the drawer and a line in the account menu.
//
// **The groups are the app's own model of your money**, not an alphabet or a usage ranking:
// net worth is what you own plus what you've saved minus what you owe, and the last group is
// the part that hasn't happened yet. Eight flat rows made you read all eight to find one;
// three named groups mean you read one heading and then two or three rows.
//
// Subscriptions sit under "Money out" rather than beside Debts under anything owed — they
// are deliberately outside net worth (see `lib/subscriptions.ts`), being neither a thing you
// own nor a debt you owe. What they have in common with a loan is only the direction the
// money travels, and that is exactly what the heading claims.
interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavSection {
  /** Null for the opening group — Dashboard is the whole of it, and a heading over one row
   *  is a label pretending to be structure. */
  label: string | null;
  links: NavLink[];
}

const SECTIONS: NavSection[] = [
  {
    label: null,
    links: [{ href: '/', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Money in',
    links: [
      { href: '/investments', label: 'Investments', icon: TrendingUp },
      // Next to Investments because it's the other half of the same subject: what you hold,
      // then what you did. Amber matches the dashboard's own "History" shortcut.
      { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
      { href: '/savings', label: 'Savings', icon: PiggyBank },
    ],
  },
  {
    label: 'Money out',
    links: [
      { href: '/debts', label: 'Debts', icon: CreditCard },
      { href: '/subscriptions', label: 'Subscriptions', icon: CalendarSync },
    ],
  },
  {
    label: "What's ahead",
    links: [
      { href: '/goals', label: 'Goals', icon: Target },
      { href: '/forecast', label: 'Forecast', icon: LineChart },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

/** The mark. The design's sidebar has just the word "Netlens" in the heavy display face. The green
 *  disc is for the places too narrow for the word: the collapsed rail and a small phone. */
function BrandMark({
  size = 'sm',
  hideWord = false,
}: {
  size?: 'sm' | 'lg';
  /** Drop the word below 420px, keeping the disc. Only the top bar asks for this — see
   *  `Wordmark`; the rail and the drawer both have the width for it. */
  hideWord?: boolean;
}) {
  const lg = size === 'lg';
  return (
    <>
      <span
        aria-hidden
        data-rail-disc
        className={cn(
          'grid shrink-0 place-items-center rounded-full bg-primary pt-[0.08em] font-display font-black text-primary-foreground',
          lg ? 'size-10 text-body-lg' : 'size-8 text-body',
          // In the top bar the disc only shows once the word has gone.
          hideWord && 'min-[420px]:hidden',
        )}
      >
        N
      </span>
      <span
        data-rail-label
        data-rail-wordmark
        className={cn(
          'truncate font-display font-black whitespace-nowrap tracking-[-0.02em] leading-none',
          lg ? 'text-[30px]' : 'text-display-xs',
          hideWord && 'max-[419px]:hidden',
        )}
      >
        Netlens
      </span>
    </>
  );
}

function Wordmark() {
  return (
    // The tile always; the word only from 420px up. With the price controls, the theme
    // toggle and the account button back on this row, the word is the one thing here that
    // is pure decoration — the tile is the same home link, and the drawer's own title
    // spells the name out. Losing it below 420px is what buys the controls their space on
    // a small phone; above it everything fits at once.
    <Link
      href='/'
      className='flex shrink-0 items-center gap-2.5 text-foreground'
      aria-label='Netlens — home'
    >
      <BrandMark hideWord />
    </Link>
  );
}

/** A group's heading, in both the rail and the drawer.
 *
 *  Sentence case in quiet ink, not a letterspaced small-caps eyebrow — the same call
 *  `SummaryCards` makes about its tile labels. The heading is there to be skimmed past on
 *  the way to a row, not to compete with one. */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div data-rail-group-label className='px-3 pb-1 text-caption font-semibold text-faint'>
      {children}
    </div>
  );
}

/** The design's AppShellRow: a full pill, the icon in a 32px disc, and "here" marked by the
 *  pale-green row with the disc filled Wise Green. Shared by the rail and the drawer. */
const ROW =
  'group/nav flex items-center gap-3 rounded-full px-2 py-1.5 text-body font-semibold whitespace-nowrap text-foreground transition-colors duration-[120ms] hover:bg-pane data-[active=true]:bg-brand-soft data-[active=true]:font-semibold data-[active=true]:hover:bg-brand-soft';
const DISC =
  'grid size-8 shrink-0 place-items-center rounded-full transition-colors group-data-[active=true]/nav:bg-primary group-data-[active=true]/nav:text-primary-foreground [&_svg]:size-[18px]';

function NavPill({
  href,
  label,
  icon: Icon,
  pathname,
  onClick,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  pathname: string;
  onClick?: () => void;
}) {
  return (
    <Link href={href} onClick={onClick} data-active={isActive(pathname, href)} className={ROW}>
      <span className={DISC}>
        <Icon />
      </span>
      {label}
    </Link>
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
    // The same 900px the rail appears at (app/globals.css) — above it there is no drawer
    // to open, so the gesture must be dead there.
    const wide = window.matchMedia('(min-width: 900px)');
    let fromEdge = false;
    let startX = 0;
    let startY = 0;

    const onStart = (e: TouchEvent) => {
      if (wide.matches || open) return;
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
        <DialogPrimitive.Backdrop className='fixed inset-0 z-50 bg-(--scrim) duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0' />
        <DialogPrimitive.Popup
          onTouchStart={onPopupTouchStart}
          onTouchEnd={onPopupTouchEnd}
          className='panel-surface fixed inset-y-3 left-3 z-50 flex w-[17rem] max-w-[85%] flex-col gap-5 overflow-y-auto rounded-3xl p-4 duration-150 outline-none data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left'>
          <DialogPrimitive.Title className='flex items-center gap-2.5 px-3 pt-1'>
            <BrandMark />
          </DialogPrimitive.Title>

          {/* The same groups the rail shows, in the same order. The drawer *is* the rail on
              a narrow screen, so a second arrangement of the same eight links would be a
              second thing to keep in step. */}
          <nav className='flex flex-col gap-4'>
            {SECTIONS.map((section, i) => (
              <div key={section.label ?? i} className='flex flex-col gap-1'>
                {section.label && <GroupLabel>{section.label}</GroupLabel>}
                {section.links.map((l) => (
                  <NavPill
                    key={l.href}
                    href={l.href}
                    label={l.label}
                    icon={l.icon}
                    pathname={pathname}
                    onClick={() => setOpen(false)}
                  />
                ))}
              </div>
            ))}
          </nav>

          {/* Only Settings. The price controls, the theme toggle and the account button
              spent a while down here, on the theory that the narrow header had no width
              for them — but a drawer you have to open first is a bad home for a control
              you glance at (the live clock and the refresh state) or reach for in one tap.
              They're back on the top bar at every width; what made that row impossible
              before was its 70px height and the full-width wordmark, and neither is there
              now. */}
          <div className='mt-auto border-t border-divider pt-3'>
            <NavPill
              href='/settings'
              label='Settings'
              icon={Settings}
              pathname={pathname}
              onClick={() => setOpen(false)}
            />
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}


/** One row of the side rail. The label is a sibling of the icon rather than plain text so
 *  the collapsed rail can drop it in CSS — collapsing must not change the markup, or it
 *  couldn't be applied before paint. */
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
    <Link href={href} data-active={isActive(pathname, href)} title={label} className={ROW}>
      <span className={DISC}>
        <Icon />
      </span>
      <span data-rail-label className='min-w-0 truncate'>{label}</span>
    </Link>
  );
}

/**
 * The side rail from the design file. It's rendered on every page and shown by CSS from
 * 900px up rather than by a client branch, so the markup never depends on a measurement the
 * server can't take. Below that width the drawer carries the same groups.
 *
 * The collapsed/expanded preference is applied before paint (`lib/nav-layout.ts`), which
 * only works because collapsing changes CSS and never the markup.
 */
function SideRail({ pathname }: { pathname: string }) {
  return (
    <aside data-side-rail>
      <div data-rail-brand>
        <Link href='/' className='flex min-w-0 items-center gap-[11px] text-foreground' aria-label='Netlens — home'>
          <BrandMark size='lg' />
        </Link>
        <button
          type='button'
          onClick={toggleNavCollapsed}
          aria-label='Toggle sidebar width'
          title='Toggle sidebar width'
          className='grid size-8 shrink-0 place-items-center rounded-full bg-pane text-muted-foreground transition-colors hover:bg-pane-2 hover:text-foreground'
        >
          {/* Points the other way when collapsed — a CSS rotation, so the button doesn't
              have to know the state React can't see on the server. */}
          <ChevronsLeft data-rail-chevron className='size-4' />
        </button>
      </div>

      <nav data-rail-nav>
        {SECTIONS.map((section, i) => (
          <div data-rail-group key={section.label ?? i}>
            {section.label && <GroupLabel>{section.label}</GroupLabel>}
            {section.links.map((l) => (
              <RailLink key={l.href} href={l.href} label={l.label} icon={l.icon} pathname={pathname} />
            ))}
          </div>
        ))}
      </nav>

      {/* No foot any more. It carried Settings and Sign out, which the account menu in the
          header now owns in both layouts — and unlike the old header icons, which CSS could
          hide in rail mode, a rail row and a menu row are visible at the same time, so the
          two really were on screen together. The rail is sections; the account button is the
          account. */}
    </aside>
  );
}

export function Nav() {
  const pathname = usePathname();
  return (
    <>
      {/* Mounted once, here, and renders nothing. Every price timer in the app lives inside
          it, so the controls can appear in the header and the drawer at the same time
          without either one polling. */}
      <PricePoller />
      <SideRail pathname={pathname} />
      <header data-app-header className='sticky top-0 z-40 bg-(--header-bg) pt-[env(safe-area-inset-top)] backdrop-blur-[14px]'>
        {/* Must track <main>'s max-width in app/layout.tsx, or the header sits narrower
            than the content beneath it. The left/right padding also clears the safe areas:
            the iPhone notch in landscape and, on iPadOS 26, the window-control traffic
            lights overlaid on the top-left of a windowed/split web app — without this they
            sit on top of the drawer's hamburger. */}
        {/* Shorter below the rail's breakpoint. It carries two things there — the drawer
            trigger and the mark — and 70px of sticky chrome for that was most of what made
            the bar look wrong on a phone. */}
        <div data-app-header-inner className='mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between gap-3 pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] sm:pl-[max(1.625rem,env(safe-area-inset-left))] sm:pr-[max(1.625rem,env(safe-area-inset-right))] min-[900px]:h-[70px] xl:max-w-[1400px] 2xl:max-w-[1640px]'>
          {/* display:none until 900px, where the rail takes the links and the wordmark and
              the header's left side is free for the search field. */}
          <HeaderSearch />

          {/* Narrow only: the way into the drawer, and the mark. From 900px the rail
              carries both and the search field takes this side of the row instead. */}
          <div className='flex min-w-0 items-center gap-2.5 min-[900px]:hidden'>
            <MobileNav pathname={pathname} />
            <Wordmark />
          </div>

          {/* At every width, which is the point: the price controls are the app's only
              live thing, and burying them in a drawer meant you had to open the drawer to
              find out whether the figures on screen were current. `LivePrices` already
              answers the narrow row on its own — the clock waits for xl, and both controls
              drop their words below sm to a dot + interval and a bare refresh glyph — so
              the phone gets the same three controls, spelt shorter. */}
          <div className='flex shrink-0 items-center gap-1.5 sm:gap-2'>
            <LivePrices />
            <MaskToggle />
            <ThemeToggle />
            {/* The design's header affordances are bordered circles on the panel surface,
                not bare glyphs — they have to hold their own against a chart scrolling
                under the translucent bar. The account menu is the only thing in the app
                that says whose account Settings and Sign out act on, which is why it isn't
                folded into the rail's rows. */}
            <UserMenu />
          </div>
        </div>
      </header>
    </>
  );
}
