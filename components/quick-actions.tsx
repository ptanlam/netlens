import Link from "next/link";
import { ArrowDownToLine, ArrowUpRight, History, LayoutGrid } from "lucide-react";

/**
 * The design's 4-up tile row in the dashboard rail. Every tile here goes somewhere real —
 * the design's are Add / Withdraw / History / More against a wallet it doesn't have, so
 * they're mapped onto the four things this app actually does from the dashboard.
 */
const ACTIONS = [
  { href: "/investments", label: "Add", icon: ArrowUpRight },
  { href: "/savings", label: "Deposit", icon: ArrowDownToLine },
  { href: "/transactions", label: "History", icon: History },
  { href: "/settings", label: "More", icon: LayoutGrid },
];

export function QuickActions() {
  return (
    <section className="card-surface grid grid-cols-4 content-center px-2.5 py-4">
      {ACTIONS.map(({ href, label, icon: Icon }) => (
        <Link
          key={label}
          href={href}
          className="group/qa flex flex-col items-center gap-2 py-1 text-body-sm font-semibold text-foreground"
        >
          {/* Wise's circular icon container: sage on a white card, filling Wise Green on
              hover, the same way the nav's current row does. */}
          <span className="grid size-11 place-items-center rounded-full bg-pane transition-colors duration-[120ms] group-hover/qa:bg-primary group-hover/qa:text-primary-foreground">
            <Icon className="size-5" />
          </span>
          {label}
        </Link>
      ))}
    </section>
  );
}
