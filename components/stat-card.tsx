import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tone = "violet" | "sky" | "emerald" | "amber" | "rose" | "blue" | "teal";

/** Per-tone class sets — kept as literal strings so Tailwind can see them. */
const TONES: Record<Tone, { ring: string; tint: string; glow: string; icon: string; shadow: string }> = {
  violet: {
    ring: "ring-violet-200/70 dark:ring-violet-400/20",
    tint: "from-violet-500/10",
    glow: "bg-violet-500/20 dark:bg-violet-400/25",
    icon: "bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300",
    shadow: "hover:shadow-violet-500/15",
  },
  sky: {
    ring: "ring-sky-200/70 dark:ring-sky-400/20",
    tint: "from-sky-500/10",
    glow: "bg-sky-500/20 dark:bg-sky-400/25",
    icon: "bg-sky-100 text-sky-600 dark:bg-sky-500/20 dark:text-sky-300",
    shadow: "hover:shadow-sky-500/15",
  },
  emerald: {
    ring: "ring-emerald-200/70 dark:ring-emerald-400/20",
    tint: "from-emerald-500/10",
    glow: "bg-emerald-500/20 dark:bg-emerald-400/25",
    icon: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300",
    shadow: "hover:shadow-emerald-500/15",
  },
  amber: {
    ring: "ring-amber-200/70 dark:ring-amber-400/20",
    tint: "from-amber-500/10",
    glow: "bg-amber-500/25 dark:bg-amber-400/25",
    icon: "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300",
    shadow: "hover:shadow-amber-500/15",
  },
  rose: {
    ring: "ring-rose-200/70 dark:ring-rose-400/20",
    tint: "from-rose-500/10",
    glow: "bg-rose-500/20 dark:bg-rose-400/25",
    icon: "bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300",
    shadow: "hover:shadow-rose-500/15",
  },
  blue: {
    ring: "ring-blue-200/70 dark:ring-blue-400/20",
    tint: "from-blue-500/10",
    glow: "bg-blue-500/20 dark:bg-blue-400/25",
    icon: "bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300",
    shadow: "hover:shadow-blue-500/15",
  },
  teal: {
    ring: "ring-teal-200/70 dark:ring-teal-400/20",
    tint: "from-teal-500/10",
    glow: "bg-teal-500/20 dark:bg-teal-400/25",
    icon: "bg-teal-100 text-teal-600 dark:bg-teal-500/20 dark:text-teal-300",
    shadow: "hover:shadow-teal-500/15",
  },
};

export function StatCard({
  label,
  value,
  valueClassName,
  sub,
  icon: Icon,
  tone = "blue",
  className,
  index = 0,
  children,
}: {
  label: React.ReactNode;
  value?: React.ReactNode;
  valueClassName?: string;
  sub?: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  className?: string;
  /** Position in a row of cards — staggers the entrance animation. */
  index?: number;
  children?: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <div
      style={{ animationDelay: `${Math.min(index * 70, 350)}ms` }}
      className={cn(
        "group relative flex animate-rise-in flex-col overflow-hidden rounded-xl bg-card p-4 ring-1 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg",
        t.ring,
        t.shadow,
        className,
      )}
    >
      {/* colour wash + soft corner glow */}
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent", t.tint)} />
      <div className={cn("pointer-events-none absolute -top-10 -right-8 size-32 rounded-full blur-2xl", t.glow)} />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-muted-foreground">{label}</div>
          {value != null && (
            <div className={cn("mt-1 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl", valueClassName)}>
              {value}
            </div>
          )}
          {sub && <div className="mt-0.5 text-sm text-muted-foreground">{sub}</div>}
        </div>
        {Icon && (
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", t.icon)}>
            <Icon className="size-5" />
          </span>
        )}
      </div>
      {children && <div className="relative mt-auto pt-3">{children}</div>}
    </div>
  );
}
