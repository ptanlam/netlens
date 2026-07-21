"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const THEMES = [
  { value: "system", label: "Match system", hint: "Follows your OS setting", icon: Monitor },
  { value: "light", label: "Daylight", hint: "Light", icon: Sun },
  { value: "dark", label: "Midnight", hint: "Dark", icon: Moon },
] as const;

type Choice = (typeof THEMES)[number]["value"];

const emptySubscribe = () => () => {};

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();

  // `theme` is only known client-side. Render the same markup on both passes and let the
  // selection light up after mount, rather than guessing and flipping it after hydration.
  // useSyncExternalStore gives server=false / client=true without the set-state-in-effect
  // the React Compiler lint forbids.
  const mounted = React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const current = (THEMES.some((t) => t.value === theme) ? theme : "system") as Choice;

  return (
    <div className="card-surface px-6 py-6">
      <div className="text-[18px] font-bold tracking-[-0.01em]">Appearance</div>
      <div className="mt-1 max-w-[760px] text-[13px] text-muted-foreground">
        The theme this browser uses. Stored on this device, not in your data.
      </div>

      <div
        role="radiogroup"
        aria-label="Theme"
        className="mt-5 grid gap-2.5 sm:grid-cols-3"
      >
        {THEMES.map((t) => {
          const selected = mounted && current === t.value;
          const Icon = t.icon;
          return (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(t.value)}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors",
                selected
                  ? "border-accent-brand/40 bg-accent"
                  : "border-input bg-transparent hover:bg-muted",
              )}
            >
              <Icon className={cn("size-4 shrink-0", selected ? "text-accent-brand" : "text-muted-foreground")} />
              <span className="min-w-0 flex-1">
                <span className={cn("block text-[13.5px] font-medium", selected && "text-accent-foreground")}>
                  {t.label}
                </span>
                <span className="block text-[11.5px] text-muted-foreground">{t.hint}</span>
              </span>
              {selected && <Check className="size-3.5 shrink-0 text-accent-brand" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
