import * as React from "react";

/** A money figure inside a line of prose. "Hide amounts" (`lib/mask.ts`) masks anything
 *  carrying `data-amount`, so wrap just the amount and leave its words readable. When the
 *  figure is the whole element, put `data-amount` on that element instead. */
export function Amt({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span data-amount className={className}>
      {children}
    </span>
  );
}
