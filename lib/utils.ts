import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The type scale in `app/globals.css` (`--text-*`) uses names tailwind-merge can't know,
// so left alone it reads `text-body-lg` as a colour and drops it beside `text-destructive`:
// a signed figure lost its size the moment it got its tone. Keep this list in step with
// the `--text-*` sizes there.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["caption", "body-sm", "body", "body-lg", "field", "display-xs", "display-sm"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
