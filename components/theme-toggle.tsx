"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** The three choices, in the order they're offered. Lives here rather than on the settings
 *  page because the header is where the control is now — settings keeps only Navigation. */
export const THEMES = [
  { value: "system", label: "Match system", hint: "Follows your OS setting", icon: Monitor },
  { value: "light", label: "Daylight", hint: "Light", icon: Sun },
  { value: "dark", label: "Midnight", hint: "Dark", icon: Moon },
] as const;

type Choice = (typeof THEMES)[number]["value"];

const emptySubscribe = () => () => {};

/**
 * Theme picker for the header.
 *
 * A menu rather than a light/dark toggle, because "Match system" is a real third state and
 * a two-way switch can't express it. It's a `Select` with the chevron dropped so it reads
 * as one of the round header affordances beside it, not as a form field.
 *
 * The chosen theme is only knowable in the browser, so the first client render has to match
 * the server's or React throws out the header and re-renders it. Both passes draw the
 * system icon; the real one lights up after mount. `useSyncExternalStore` gives that
 * server=false / client=true without the set-state-in-effect the React Compiler forbids —
 * same approach `AppearanceSettings` uses for its cards.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = React.useSyncExternalStore(emptySubscribe, () => true, () => false);

  const current = (
    mounted && THEMES.some((t) => t.value === theme) ? theme : "system"
  ) as Choice;
  const Icon: LucideIcon = THEMES.find((t) => t.value === current)!.icon;

  return (
    <Select value={current} onValueChange={(v) => v != null && setTheme(v)}>
      <SelectTrigger
        hideIcon
        // Matches the Settings gear: a bordered circle on the panel surface, so it holds
        // its own against a chart scrolling under the translucent bar.
        className={cn(
          "size-9 items-center justify-center rounded-full border-input bg-card p-0 text-muted-foreground transition-colors hover:text-foreground dark:bg-card dark:hover:bg-card",
          className,
        )}
        aria-label={`Theme: ${THEMES.find((t) => t.value === current)!.label}`}
      >
        <Icon className="size-4" />
      </SelectTrigger>
      <SelectContent>
        {THEMES.map((t) => (
          <SelectItem key={t.value} value={t.value}>
            {t.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
