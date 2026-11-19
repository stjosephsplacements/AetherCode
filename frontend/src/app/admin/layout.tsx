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
      college={<CollegePicker colleges={staff.tenants.map((tenant) => ({ id: tenant.id, name: tenant.display_name }))} selected={selected?.id ?? ""} />}
    >
      {children}
    </StaffShell>
  );
}
