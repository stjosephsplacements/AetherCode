import { TenantSwitcher } from "@/components/staff/tenant-switcher";
import { type NavGroup } from "@/components/staff/staff-nav";
import { StaffShell } from "@/components/staff/staff-shell";
import { brandFor } from "@/lib/server/branding";
import { requireStaff } from "@/lib/server/staff";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const groups: NavGroup[] = [
    {
      label: "Assess",
      items: [
        { href: "/staff", label: "Dashboard", icon: "home" },
        { href: "/staff/exams", label: "Exams", icon: "exams" },
        { href: "/staff/calendar", label: "Calendar", icon: "calendar" },
        { href: "/staff/questions", label: "Questions", icon: "questions" },
        { href: "/staff/analytics", label: "Analytics", icon: "analytics" },
        { href: "/staff/community", label: "Community", icon: "community" },
      ],
    },
  ];
  if (staff.canManageAccounts) {
    groups.push({
      label: "People",
      items: [
        { href: "/staff/students", label: "Students", icon: "students" },
        { href: "/staff/placements", label: "Placements", icon: "placements" },
        { href: "/staff/organisation", label: "Departments", icon: "organisation" },
        { href: "/staff/accounts", label: "Staff accounts", icon: "accounts" },
        { href: "/staff/permissions", label: "Permissions", icon: "accounts" },
      ],
    });
    groups.push({
      label: "Platform",
      items: [
        ...(staff.isPlatformAdmin ? [{ href: "/staff/colleges", label: "Colleges", icon: "organisation" } as const] : []),
        { href: "/staff/audit", label: "Audit log", icon: "audit" },
        { href: "/staff/status", label: "System status", icon: "status" },
      ],
    });
  }
  return (
    <StaffShell
      viewer={staff.viewer}
      tenantId={staff.tenantId}
      groups={groups}
      brand={await brandFor(staff.tenantId)}
      college={staff.isPlatformAdmin ? <TenantSwitcher tenants={staff.tenants} current={staff.viewAll ? "all" : staff.tenantId} /> : undefined}
    >
      {children}
    </StaffShell>
  );
}
