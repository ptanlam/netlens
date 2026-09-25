"use client";

import * as React from "react";
import { Check, PanelLeft, PanelLeftClose, type LucideIcon } from "lucide-react";
import { setNavCollapsed, useNavCollapsed } from "@/lib/nav-layout";
import { cn } from "@/lib/utils";

/**
 * How wide the sidebar sits. This card used to choose *where* the navigation lived — the
 * rail, or a top bar carrying the links across the header. The top bar is gone: below the
 * rail's breakpoint it was the only layout either choice produced, and there it had to hold
 * a drawer trigger, the wordmark, the price controls, a theme toggle and the account button
 * on one row. What is left to choose is a width.
 */
const WIDTHS = [
  { value: "expanded", label: "Expanded", hint: "Icons and labels", icon: PanelLeft },
  { value: "collapsed", label: "Collapsed", hint: "Icons only", icon: PanelLeftClose },
] as const;

const emptySubscribe = () => () => {};

type Option = { value: string; label: string; hint: string; icon: LucideIcon };

/** The one control shape this page uses: a row of radio cards, ticked when chosen. */
function ChoiceGrid({
  label,
  options,
  value,
  onChange,
  /** False until mount for anything the server can't know — see the note in
   *  <AppearanceSettings>. Renders every card unselected rather than guessing and
   *  flipping after hydration. */
  ready,
}: {
  label: string;
  options: readonly Option[];
  value: string;
  onChange: (v: string) => void;
  ready: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("mt-5 grid gap-2.5", options.length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2")}
    >
      {options.map((o) => {
        const selected = ready && value === o.value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors",
              selected ? "border-accent-brand/40 bg-accent" : "border-input bg-transparent hover:bg-muted",
            )}
          >
            <Icon className={cn("size-4 shrink-0", selected ? "text-accent-brand" : "text-muted-foreground")} />
            <span className="min-w-0 flex-1">
              <span className={cn("block text-body-sm font-semibold", selected && "text-accent-foreground")}>
                {o.label}
              </span>
              <span className="block text-caption text-muted-foreground">{o.hint}</span>
            </span>
            {selected && <Check className="size-3.5 shrink-0 text-accent-brand" />}
          </button>
        );
      })}
    </div>
  );
}

export function AppearanceSettings() {
  const collapsed = useNavCollapsed();

  // The layout is only known client-side (it's a localStorage preference). Render the same
  // markup on both passes and let the selection light up after mount, rather than guessing
  // and flipping it after hydration. useSyncExternalStore gives server=false / client=true
  // without the set-state-in-effect the React Compiler lint forbids.
  const mounted = React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Theme used to be the card above this one. It's the picker in the header now —
          one click from anywhere, instead of two navigations to change how the app looks. */}
      <div className="card-surface panel-body">
        <div className="text-body-lg font-semibold tracking-[-0.01em]">Sidebar</div>
        <div className="mt-1 max-w-[760px] text-body-sm text-muted-foreground">
          How wide the sidebar sits on a screen with room for it. Narrow screens use the
          slide-out drawer either way — there isn&apos;t room for a rail beside the content,
          and the drawer carries the same groups.
        </div>

        <ChoiceGrid
          label="Sidebar width"
          options={WIDTHS}
          value={collapsed ? "collapsed" : "expanded"}
          onChange={(v) => setNavCollapsed(v === "collapsed")}
          ready={mounted}
        />
      </div>
    </div>
  );
}
