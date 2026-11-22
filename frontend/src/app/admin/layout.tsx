import { type NavGroup } from "@/components/staff/staff-nav";
import { StaffShell } from "@/components/staff/staff-shell";
import { requireAdmin } from "@/lib/server/staff";

/** The admin console: platform administrators only, across every college. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireAdmin();
  // Same ownership trees as /staff: people → grants, status → audit.
  const groups: NavGroup[] = [
    {
      label: "Overview",
      items: [
        { href: "/admin", label: "Overview", icon: "home" },
        { href: "/admin/dashboard", label: "Dashboard", icon: "analytics" },
        { href: "/admin/get-started", label: "Get started", icon: "start" },
        { href: "/admin/explore", label: "Explore", icon: "explore" },
      ],
    },
    {
      label: "Platform",
      items: [
        { href: "/admin/incidents", label: "Incidents", icon: "status" },
        { href: "/admin/colleges", label: "Colleges", icon: "organisation" },
        {
          href: "/admin/placement",
          label: "Placement",
          icon: "placements",
          children: [
            { href: "/admin/placement/departments", label: "Organisation", icon: "organisation" },
            { href: "/admin/placement/officers", label: "Officers", icon: "accounts" },
          ],
        },
        {
          href: "/admin/admins",
          label: "Administrators",
          icon: "accounts",
          children: [{ href: "/admin/permissions", label: "Permissions", icon: "roles" }],
        },
        { href: "/admin/analytics", label: "Analytics", icon: "analytics" },
        { href: "/admin/status", label: "System status", icon: "status" },
        { href: "/admin/audit", label: "Audit log", icon: "audit" },
      ],
    },
  ];
  const realtimeTenant = staff.tenantId ?? staff.tenants[0]?.id ?? null;
  return (
    <StaffShell viewer={staff.viewer} tenantId={realtimeTenant} groups={groups} home="/admin" consoleLabel="Admin console">
      {children}
    </StaffShell>
  );
}
