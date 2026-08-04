import Link from "next/link";
import { ArrowDownToLine, ArrowUpRight, History, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The design's 4-up tile row in the dashboard rail. Every tile here goes somewhere real —
 * the design's are Add / Withdraw / History / More against a wallet it doesn't have, so
 * they're mapped onto the four things this app actually does from the dashboard.
 */
const ACTIONS = [
  { href: "/investments", label: "Add", icon: ArrowUpRight, tint: "text-hue-cyan" },
  { href: "/savings", label: "Deposit", icon: ArrowDownToLine, tint: "text-hue-green" },
  { href: "/transactions", label: "History", icon: History, tint: "text-hue-amber" },
  { href: "/settings", label: "More", icon: LayoutGrid, tint: "text-hue-violet" },
];

export function QuickActions() {
  return (
    <section className="card-surface grid grid-cols-4 px-2.5 py-4">
      {ACTIONS.map(({ href, label, icon: Icon, tint }) => (
        <Link
          key={label}
          href={href}
          className="group/qa flex flex-col items-center gap-2 py-1 text-[11.5px] font-medium transition-colors hover:text-foreground"
        >
          {/* The icon sits in its own tinted disc — four hues in a row is what makes this
              strip read as a set of doors rather than four grey glyphs. */}
          <span
            className={cn(
              "grid size-8 place-items-center rounded-full bg-current/12 transition-transform group-hover/qa:scale-110",
              tint,
            )}
          >
            <Icon className="size-[17px]" />
          </span>
          {label}
        </Link>
      ))}
    </section>
  );
}
