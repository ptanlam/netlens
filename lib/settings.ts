/** The settings sections. Shared by the server page (which redirects to the first one) and
 *  the client rail — so it can't live in either, or the other can't import it. */

export const SETTINGS_SECTIONS = [
  {
    href: "/settings/appearance",
    label: "Appearance",
    hint: "Theme for this device",
  },
  {
    href: "/settings/price-sources",
    label: "Price sources",
    hint: "Where live prices come from",
  },
] as const;
