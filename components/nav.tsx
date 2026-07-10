"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Menu, Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/investments", label: "Investments" },
  { href: "/savings", label: "Savings" },
  { href: "/debts", label: "Debts" },
];

const THEMES = ["system", "light", "dark"] as const;

function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const current = (theme ?? "system") as (typeof THEMES)[number];
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  const Icon = current === "light" ? Sun : current === "dark" ? Moon : Monitor;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Theme: ${current}. Switch to ${next}.`}
      title={`Theme: ${current}`}
      onClick={() => setTheme(next)}
    >
      <Icon className="size-4" />
    </Button>
  );
}

function MobileNav({ pathname }: { pathname: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        render={<Button variant="ghost" size="icon" aria-label="Open menu" />}
      >
        <Menu className="size-5" />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup className="fixed inset-y-0 left-0 z-50 flex w-64 max-w-[80%] flex-col gap-1 bg-background p-4 ring-1 ring-foreground/10 duration-150 outline-none data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left">
          <DialogPrimitive.Title className="mb-2 px-2.5 text-sm font-semibold tracking-tight">
            Investments
          </DialogPrimitive.Title>
          <nav className="flex flex-col gap-1">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "rounded-md px-2.5 py-2 text-sm transition-colors",
                  pathname === l.href
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-1 px-4 sm:px-6">
        <div className="sm:hidden">
          <MobileNav pathname={pathname} />
        </div>
        <span className="mr-3 text-sm font-semibold tracking-tight">Investments</span>
        <nav className="hidden flex-1 items-center gap-1 sm:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors",
                pathname === l.href
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex-1 sm:hidden" />
        <ThemeToggle />
      </div>
    </header>
  );
}
