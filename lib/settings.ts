/** The settings sections. Shared by the server page (which redirects to the first one) and
 *  the client rail — so it can't live in either, or the other can't import it. */

export const SETTINGS_SECTIONS = [
  {
    href: "/settings/appearance",
    label: "Appearance",
    // Theme used to be here too. It's the picker in the header now, so this section is
    // down to where the links sit — worth a rename if anything else ever joins it.
    hint: "Where the navigation sits, on this device",
  },
  {
    href: "/settings/price-sources",
    label: "Price sources",
    hint: "Where live prices come from",
  },
] as const;
