import { SettingsNav } from "@/components/settings-nav";

/** The settings shell: a section rail plus whatever section is open. New configuration
 *  areas are one entry in `SETTINGS_SECTIONS` and one folder under `app/settings/`. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-5">
        <div className="font-serif text-[22px] font-semibold tracking-[-0.01em]">Settings</div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">
          How Netlens fetches and displays your data.
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
        <SettingsNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
