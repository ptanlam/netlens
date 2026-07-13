'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Menu, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LivePrices } from '@/components/live-prices';
import { ThemeToggle } from '@/components/theme-toggle';
import { logout } from '@/app/actions';
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
    <header className='sticky top-0 z-40 border-b border-border bg-(--header-bg) backdrop-blur-[10px]'>
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
          <LivePrices />
          <ThemeToggle />
          {authEnabled && <LogoutButton />}
        </div>
      </div>
    </header>
  );
}
