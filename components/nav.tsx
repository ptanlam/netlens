"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/holdings", label: "Holdings" },
  { href: "/recurring", label: "Recurring" },
  { href: "/add", label: "Add" },
];

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="size-4 dark:hidden" />
      <Moon className="size-4 hidden dark:block" />
    </Button>
  );
}

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-1 px-4 sm:px-6">
        <span className="mr-3 text-sm font-semibold tracking-tight">Investments</span>
        <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
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
        <ThemeToggle />
      </div>
    </header>
  );
}
