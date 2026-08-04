import { SettingsNav } from "@/components/settings-nav";
import { PageHeader } from "@/components/page-header";

/** The settings shell: a section rail plus whatever section is open. New configuration
 *  areas are one entry in `SETTINGS_SECTIONS` and one folder under `app/settings/`. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader title="Settings" className="mb-6">
        How Netlens fetches and displays your data.
      </PageHeader>

      <div className="flex flex-col gap-4 sm:gap-6 lg:flex-row lg:gap-8">
        <SettingsNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
