import { cookies } from "next/headers";
import { CollegePicker } from "@/components/staff/college-picker";
import { staffNavGroups } from "@/components/staff/staff-nav-groups";
import { type NavGroup } from "@/components/staff/staff-nav";
import { StaffShell } from "@/components/staff/staff-shell";
import { collegeHref } from "@/lib/links";
import { TENANT_COOKIE, requireAdmin } from "@/lib/server/staff";

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
        { href: "/admin/branding", label: "Branding", icon: "organisation" },
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
  // The college workspace: the same pages a college administrator sees, for the college opened last.
  const picked = (await cookies()).get(TENANT_COOKIE)?.value;
  const selected = staff.tenants.find((tenant) => tenant.id === picked);
  groups.push(
    ...(selected
      ? staffNavGroups({ canManageAccounts: true, link: (path) => collegeHref(path, selected.id), prefix: "College" })
      : [{ label: "College workspace", items: [{ href: "/admin/colleges", label: "Choose a college", icon: "organisation" as const }] }]),
  );
  const realtimeTenant = staff.tenantId ?? staff.tenants[0]?.id ?? null;
  return (
    <StaffShell
      viewer={staff.viewer}
      tenantId={realtimeTenant}
      groups={groups}
      home="/admin"
      consoleLabel="Admin console"
      college={<CollegePicker colleges={staff.tenants.map((tenant) => ({ id: tenant.id, name: tenant.display_name }))} selected={selected?.id ?? ""} />}
    >
      {children}
    </StaffShell>
  );
}
