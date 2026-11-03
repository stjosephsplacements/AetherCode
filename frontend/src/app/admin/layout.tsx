import { type NavGroup } from "@/components/staff/staff-nav";
import { StaffShell } from "@/components/staff/staff-shell";
import { requireAdmin } from "@/lib/server/staff";

/** The admin console: platform administrators only, across every college. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireAdmin();
  const groups: NavGroup[] = [
    { label: "Overview", items: [{ href: "/admin", label: "Overview", icon: "home" }] },
    {
      label: "Platform",
      items: [
        { href: "/admin/colleges", label: "Colleges", icon: "organisation" },
        { href: "/admin/admins", label: "Administrators", icon: "accounts" },
        { href: "/admin/analytics", label: "Analytics", icon: "analytics" },
        { href: "/admin/status", label: "System status", icon: "status" },
        { href: "/admin/audit", label: "Audit log", icon: "audit" },
      ],
    },
    { label: "Workspaces", items: [{ href: "/staff", label: "College workspace", icon: "exams" }] },
  ];
  return (
    <StaffShell viewer={staff.viewer} tenantId={staff.tenantId} groups={groups} home="/admin">
      {children}
    </StaffShell>
  );
}
