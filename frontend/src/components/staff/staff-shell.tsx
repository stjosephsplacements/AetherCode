import { cookies } from "next/headers";
import { AccountMenu } from "@/components/account-menu";
import { Brand } from "@/components/brand";
import { type NavGroup, StaffMenu, StaffPath, ThemeToggle } from "@/components/staff/staff-nav";
import { StaffSidebar } from "@/components/staff/staff-sidebar";
import { accentStyle } from "@/lib/branding";
import { LiveIndicator, RealtimeProvider } from "@/lib/client/realtime";
import type { Brand as CollegeBrand } from "@/lib/server/branding";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";
import type { Viewer } from "@/lib/viewer";

/** Console shell: floating sidebar + rounded work surface, one realtime socket. */
export async function StaffShell({
  viewer,
  tenantId,
  groups,
  brand,
  college,
  home,
  consoleLabel,
  children,
}: {
  home?: string;
  consoleLabel?: string;
  viewer: Viewer;
  tenantId: string | null;
  groups: NavGroup[];
  brand?: CollegeBrand;
  college?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <RealtimeProvider tenantId={tenantId}>
      <div
        className="flex h-dvh gap-[var(--shell-gap)] overflow-hidden bg-canvas p-[var(--shell-gap)]"
        style={brand?.color ? accentStyle(brand.color) : undefined}
      >
        <StaffSidebar
          home={home}
          consoleLabel={consoleLabel}
          viewer={viewer}
          groups={groups}
          college={college}
          brand={<Brand brand={brand} size={20} />}
          initiallyCollapsed={(await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed"}
        />

        {/* Rounded work surface stays fixed; only <main> scrolls. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-panel border border-line bg-surface shadow-[var(--shadow-panel)]">
          <header className="z-20 flex h-[var(--shell-header)] shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6 print:hidden">
            <StaffMenu groups={groups} college={college} title={consoleLabel} />
            <StaffPath groups={groups} />
            <div className="ml-auto flex items-center gap-2">
              <LiveIndicator />
              <ThemeToggle />
              <div className="lg:hidden">
                <AccountMenu viewer={viewer} compact />
              </div>
            </div>
          </header>
          <main className="mx-auto min-h-0 w-full max-w-[1600px] flex-1 overflow-y-auto overscroll-contain px-5 pb-16 pt-8 sm:px-8">{children}</main>
        </div>
      </div>
    </RealtimeProvider>
  );
}
