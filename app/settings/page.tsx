import { redirect } from "next/navigation";
import { SETTINGS_SECTIONS } from "@/lib/settings";

/** `/settings` has no content of its own — the rail is the navigation, so land on the
 *  first section. */
export default function SettingsIndex() {
  redirect(SETTINGS_SECTIONS[0].href);
}
