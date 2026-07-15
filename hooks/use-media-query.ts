import * as React from "react";

/**
 * Track a CSS media query on the client. Returns `false` during SSR and the first
 * paint, then settles to the real match — so treat `false` as the desktop default.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
