"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SETTINGS_SECTIONS } from "@/lib/settings";
import { cn } from "@/lib/utils";

/** Section rail: a sidebar on desktop, a scrollable pill row on a phone. */
export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:w-52 lg:shrink-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
      {SETTINGS_SECTIONS.map((s) => {
        const active = pathname.startsWith(s.href);
        return (
          <Link
            key={s.href}
            href={s.href}
            className={cn(
              "shrink-0 rounded-lg px-3 py-2 transition-colors lg:shrink",
              active
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <div className="text-[13.5px] font-medium whitespace-nowrap">{s.label}</div>
            <div className="mt-0.5 hidden text-[11.5px] text-faint lg:block">{s.hint}</div>
          </Link>
        );
      })}
    </nav>
  );
}
