"use client";

import * as React from "react";
import { Check, PanelLeft, PanelTop, type LucideIcon } from "lucide-react";
import { NAV_LAYOUTS, setNavLayout, useNavLayout, type NavLayout } from "@/lib/nav-layout";
import { cn } from "@/lib/utils";

const NAV_ICONS: Record<NavLayout, LucideIcon> = { top: PanelTop, side: PanelLeft };

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
              <span className={cn("block text-[13.5px] font-medium", selected && "text-accent-foreground")}>
                {o.label}
              </span>
              <span className="block text-[11.5px] text-muted-foreground">{o.hint}</span>
            </span>
            {selected && <Check className="size-3.5 shrink-0 text-accent-brand" />}
          </button>
        );
      })}
    </div>
  );
}

export function AppearanceSettings() {
  const navLayout = useNavLayout();

  // The layout is only known client-side (it's a localStorage preference). Render the same
  // markup on both passes and let the selection light up after mount, rather than guessing
  // and flipping it after hydration. useSyncExternalStore gives server=false / client=true
  // without the set-state-in-effect the React Compiler lint forbids.
  const mounted = React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const navOptions = React.useMemo(
    () => NAV_LAYOUTS.map((l) => ({ ...l, icon: NAV_ICONS[l.value] })),
    [],
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Theme used to be the card above this one. It's the picker in the header now —
          one click from anywhere, instead of two navigations to change how the app looks. */}
      <div className="card-surface panel-body">
        <div className="text-[16px] font-bold tracking-[-0.01em]">Navigation</div>
        <div className="mt-1 max-w-[760px] text-[13px] text-muted-foreground">
          Where the links sit on a wide screen. Narrow screens keep the slide-out drawer
          either way — there isn&apos;t room for a rail beside the content.
        </div>

        <ChoiceGrid
          label="Navigation layout"
          options={navOptions}
          value={navLayout}
          onChange={(v) => setNavLayout(v as NavLayout)}
          ready={mounted}
        />
      </div>
    </div>
  );
}
