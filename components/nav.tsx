'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Menu, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { logout, refreshPrices } from '@/app/actions';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/investments', label: 'Investments' },
  { href: '/savings', label: 'Savings' },
  { href: '/debts', label: 'Debts' },
  { href: '/sources', label: 'Price sources' },
];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

/** Live clock + one-tap price refresh, mirroring the mockup's top-right. */
/** Poll interval when live refresh is armed. */
const LIVE_INTERVAL_MS = 60_000;

function NavPrices() {
  const [now, setNow] = React.useState<Date | null>(null);
  const [live, setLive] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0); // async so we don't setState synchronously in the effect
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  // While live is armed, silently re-pull prices on an interval.
  React.useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      startTransition(async () => {
        const res = await refreshPrices();
        if (!res.ok) toast.warning(res.message);
      });
    }, LIVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [live]);

  const p2 = (n: number) => String(n).padStart(2, '0');
  const stamp = now
    ? `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`
    : '—';

  function refresh() {
    if (pending) return;
    startTransition(async () => {
      const res = await refreshPrices();
      if (res.ok) toast.success(res.message);
      else toast.warning(res.message);
    });
  }

  return (
    <div className='flex items-center gap-2 sm:gap-3.5'>
      <div className='hidden text-right leading-tight sm:block'>
        <div className='font-mono text-[10px] tracking-[0.06em] text-[#a5a29a] uppercase'>Live prices</div>
        <div className='font-mono text-[11.5px] tabular-nums text-muted-foreground'>{stamp}</div>
      </div>
      <button
        type='button'
        onClick={() => setLive((v) => !v)}
        aria-pressed={live}
        title={live ? `Live refresh on — every ${LIVE_INTERVAL_MS / 1000}s` : 'Enable live refresh'}
        className={cn(
          'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11.5px] transition-colors',
          live
            ? 'border-accent-brand/40 bg-accent text-accent-foreground'
            : 'border-input bg-card text-muted-foreground hover:bg-muted',
        )}
      >
        <span className={cn('size-1.5 rounded-full', live ? 'animate-pulse bg-accent-brand' : 'bg-[#c9c4b9]')} />
        Live
      </button>
      <button
        type='button'
        onClick={refresh}
        disabled={pending}
        className='flex items-center gap-1.5 rounded-lg border border-input bg-card px-3 py-1.5 font-mono text-[11.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-60'
      >
        <span className={cn('size-1.5 rounded-full bg-accent-brand', pending && 'animate-ping')} />
        Refresh
      </button>
    </div>
  );
}

function Wordmark() {
  return (
    <Link href='/' className='flex items-center gap-2.5 text-foreground' aria-label='Netlens — home'>
      <span className='size-[9px] shrink-0 rounded-[2px] bg-foreground' />
      <span className='hidden font-serif text-[17px] font-semibold whitespace-nowrap tracking-[-0.01em] min-[420px]:inline'>
        Netlens
      </span>
    </Link>
  );
}

function NavPill({
  href,
  label,
  pathname,
  onClick,
}: {
  href: string;
  label: string;
  pathname: string;
  onClick?: () => void;
}) {
  const active = isActive(pathname, href);
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'rounded-[7px] px-[11px] py-1.5 text-[13.5px] whitespace-nowrap transition-colors',
        active
          ? 'bg-foreground font-medium text-background'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      {label}
    </Link>
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
              <NavPill key={l.href} href={l.href} label={l.label} pathname={pathname} onClick={() => setOpen(false)} />
            ))}
          </nav>
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
    <header className='sticky top-0 z-40 border-b border-border bg-[rgba(244,242,238,0.86)] backdrop-blur-[10px]'>
      <div className='mx-auto flex h-[58px] w-full max-w-[1180px] items-center justify-between gap-3 px-5 sm:px-8'>
        <div className='flex min-w-0 items-center gap-3 sm:gap-7'>
          <div className='sm:hidden'>
            <MobileNav pathname={pathname} />
          </div>
          <Wordmark />
          <nav className='hidden items-center gap-0.5 sm:flex'>
            {LINKS.map((l) => (
              <NavPill key={l.href} href={l.href} label={l.label} pathname={pathname} />
            ))}
          </nav>
        </div>
        <div className='flex items-center gap-2'>
          <NavPrices />
          {authEnabled && <LogoutButton />}
        </div>
      </div>
    </header>
  );
}
