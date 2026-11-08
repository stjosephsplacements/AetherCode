import { type NavGroup } from "@/components/staff/staff-nav";
import { StaffShell } from "@/components/staff/staff-shell";
import { requireAdmin } from "@/lib/server/staff";

/** The admin console: platform administrators only, across every college. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireAdmin();
  const groups: NavGroup[] = [
    {
      label: "Overview",
      items: [
        { href: "/admin", label: "Overview", icon: "home" },
        { href: "/admin/get-started", label: "Get started", icon: "start" },
      ],
    },
    {
      label: "Platform",
      items: [
        { href: "/admin/incidents", label: "Incidents", icon: "status" },
        { href: "/admin/colleges", label: "Colleges", icon: "organisation" },
        { href: "/admin/admins", label: "Administrators", icon: "accounts" },
        { href: "/staff/permissions?scope=platform", label: "Permissions", icon: "roles" },
        { href: "/admin/analytics", label: "Analytics", icon: "analytics" },
        { href: "/admin/status", label: "System status", icon: "status" },
        { href: "/admin/audit", label: "Audit log", icon: "audit" },
      ],
    },
    {
      label: "Placement",
      items: [
        { href: "/placement", label: "Placements", icon: "placements" },
        { href: "/placement/departments", label: "Departments", icon: "organisation" },
        { href: "/placement/staff", label: "Officers", icon: "accounts" },
      ],
    },
  ];
  const realtimeTenant = staff.tenantId ?? staff.tenants[0]?.id ?? null;
  return (
    <StaffShell viewer={staff.viewer} tenantId={realtimeTenant} groups={groups} home="/admin">
      {children}
    </StaffShell>
  );
}
