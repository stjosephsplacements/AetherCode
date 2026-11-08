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

/** The staff console: grouped sidebar, a path bar on top, content on the canvas, one realtime socket for all of it. */
export async function StaffShell({ viewer, tenantId, groups, brand, college, home, children }: { home?: string; viewer: Viewer; tenantId: string | null; groups: NavGroup[]; brand?: CollegeBrand; college?: React.ReactNode; children: React.ReactNode }) {
  return (
    <RealtimeProvider tenantId={tenantId}>
      <div className="flex min-h-dvh" style={brand?.color ? accentStyle(brand.color) : undefined}>
        <StaffSidebar home={home} viewer={viewer} groups={groups} college={college} brand={<Brand brand={brand} size={20} />} initiallyCollapsed={(await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed"} />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="liquid-glass sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-line px-4 sm:px-6 print:hidden">
            <StaffMenu groups={groups} college={college} />
            <StaffPath groups={groups} />
            <div className="ml-auto flex items-center gap-2">
              <LiveIndicator />
              <ThemeToggle />
              <div className="lg:hidden">
                <AccountMenu viewer={viewer} compact />
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1600px] flex-1 px-5 pb-16 pt-8 sm:px-8 lg:pt-8">{children}</main>
        </div>
      </div>
    </RealtimeProvider>
  );
}
