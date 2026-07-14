"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { groupDigits } from "@/lib/format";

/** Index just past the `n`th digit of `s` — where the caret belongs after regrouping. */
function caretAfterDigits(s: string, n: number): number {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < s.length; i++) {
    if (/\d/.test(s[i])) {
      seen++;
      if (seen === n) return i + 1;
    }
  }
  return s.length;
}

const countDigits = (s: string) => (s.match(/\d/g) ?? []).length;

/**
 * A VND amount field that reads like money — "1.000.000" — while you type it.
 *
 * `type="number"` can't render group separators at all, so this is a text input that
 * formats on every keystroke and posts the raw digits through a hidden field of the same
 * `name`. Server actions keep parsing a plain integer and never see the dots (they'd
 * `Number()` to NaN, and stripping them in the actions isn't an option — `.` is a decimal
 * point for the rate and quantity fields).
 *
 * Amounts here are always unsigned; direction (buy/sell) is a separate control.
 */
export function CurrencyInput({
  name,
  defaultValue,
  onValueChange,
  ...props
}: Omit<React.ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange"> & {
  name: string;
  defaultValue?: number | string | null;
  /** Fires with the numeric value (0 when empty) — for forms that react to the amount. */
  onValueChange?: (value: number) => void;
}) {
  const initial =
    defaultValue == null || defaultValue === "" ? "" : groupDigits(String(defaultValue));
  const [display, setDisplay] = React.useState(initial);
  const ref = React.useRef<HTMLInputElement>(null);
  // Regrouping rewrites the whole string, which would otherwise fling the caret to the
  // end mid-edit. Stash where it should land and restore it once the new value is in.
  const caret = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (caret.current != null && ref.current) {
      ref.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [display]);

  // The value lives in React state, so `form.reset()` — which every add-form calls after a
  // successful save — sails straight past it and leaves the old amount sitting in the box.
  React.useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const onReset = () => setDisplay(initial);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [initial]);

  const raw = display.replace(/\./g, "");

  return (
    <>
      <Input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={display}
        onChange={(e) => {
          const el = e.currentTarget;
          const before = countDigits(el.value.slice(0, el.selectionStart ?? el.value.length));
          const next = groupDigits(el.value);
          caret.current = caretAfterDigits(next, before);
          setDisplay(next);
          onValueChange?.(Number(next.replace(/\./g, "")) || 0);
        }}
        {...props}
      />
      <input type="hidden" name={name} value={raw} />
    </>
  );
}
