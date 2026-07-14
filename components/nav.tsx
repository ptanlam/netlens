'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import {
  Menu, LogOut, Settings,
  LayoutDashboard, TrendingUp, PiggyBank, CreditCard, Target,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LivePrices } from '@/components/live-prices';
import { logout } from '@/app/actions';
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
      <span className='size-[9px] shrink-0 rounded-[2px] bg-foreground' />
      <span className='font-serif text-[17px] font-semibold whitespace-nowrap tracking-[-0.01em]'>Netlens</span>
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
        'relative z-10 flex items-center gap-1.5 rounded-[7px] px-[11px] py-1.5 text-[13.5px] whitespace-nowrap transition-colors',
        active
          ? cn('font-medium text-background', variant === 'solid' && 'bg-foreground')
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
        slider.style.transform = `translateX(${active.offsetLeft}px)`;
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
    return () => ro.disconnect();
  }, [pathname]);

  return (
    <nav ref={navRef} className='relative hidden items-center gap-0.5 lg:flex'>
      <span
        ref={sliderRef}
        aria-hidden
        className='absolute inset-y-0 left-0 z-0 rounded-[7px] bg-foreground opacity-0 transition-[transform,width,opacity] duration-300 ease-out motion-reduce:transition-none'
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

function MobileNav({ pathname }: { pathname: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger render={<Button variant='ghost' size='icon' aria-label='Open menu' />}>
        <Menu className='size-5' />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className='fixed inset-0 z-50 bg-black/40 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0' />
        <DialogPrimitive.Popup className='fixed inset-y-0 left-0 z-50 flex w-64 max-w-[80%] flex-col gap-1 bg-card p-4 ring-1 ring-border duration-150 outline-none data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left'>
          <DialogPrimitive.Title className='mb-2 flex items-center gap-2.5 px-1.5'>
            <span className='size-[9px] rounded-[2px] bg-foreground' />
            <span className='font-serif text-base font-semibold tracking-tight'>Netlens</span>
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
                'flex items-center gap-2 rounded-[7px] px-[11px] py-1.5 text-[13.5px] transition-colors',
                isActive(pathname, '/settings')
                  ? 'bg-foreground font-medium text-background'
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
      <Button variant='ghost' size='icon' type='submit' aria-label='Sign out' title='Sign out'>
        <LogOut className='size-4' />
      </Button>
    </form>
  );
}

export function Nav({ authEnabled = false }: { authEnabled?: boolean }) {
  const pathname = usePathname();
  if (pathname === '/login') return null;
  return (
    <header className='sticky top-0 z-40 border-b border-border bg-(--header-bg) backdrop-blur-[10px]'>
      <div className='mx-auto flex h-[58px] w-full max-w-[1180px] items-center justify-between gap-3 px-5 sm:px-8'>
        {/* The pills only clear the price controls from ~1024px up; below that they
            collide with them, so the drawer holds the links until lg. */}
        <div className='flex min-w-0 items-center gap-3 lg:gap-7'>
          <div className='lg:hidden'>
            <MobileNav pathname={pathname} />
          </div>
          <Wordmark />
          <DesktopNav pathname={pathname} />
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <LivePrices />
          <Button
            variant='ghost'
            size='icon'
            aria-label='Settings'
            title='Settings'
            nativeButton={false}
            className='hidden sm:inline-flex'
            render={<Link href='/settings' />}
          >
            <Settings className='size-4' />
          </Button>
          {authEnabled && <LogoutButton />}
        </div>
      </div>
    </header>
  );
}
