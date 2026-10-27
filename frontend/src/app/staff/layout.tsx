import { AppShell } from "@/components/app-shell";
import type { NavItem } from "@/components/nav-links";
import { TenantSwitcher } from "@/components/staff/tenant-switcher";
import { brandFor } from "@/lib/server/branding";
import { requireStaff } from "@/lib/server/staff";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const nav: NavItem[] = [
    { href: "/staff", label: "Overview", icon: "home" },
    { href: "/staff/exams", label: "Exams", icon: "exams" },
    { href: "/staff/calendar", label: "Calendar", icon: "calendar" },
    { href: "/staff/questions", label: "Questions", icon: "questions" },
    { href: "/staff/community", label: "Community", icon: "community" },
    { href: "/staff/analytics", label: "Analytics", icon: "analytics" },
  ];
  if (staff.isPlatformAdmin) nav.push({ href: "/staff/colleges", label: "Colleges", icon: "organisation" });
  if (staff.canManageAccounts) {
    nav.push(
      { href: "/staff/students", label: "Students", icon: "students" },
      { href: "/staff/placements", label: "Placements", icon: "placements" },
      { href: "/staff/organisation", label: "Departments", icon: "organisation" },
      { href: "/staff/accounts", label: "Staff accounts", icon: "accounts" },
      { href: "/staff/audit", label: "Audit log", icon: "audit" },
      { href: "/staff/status", label: "System status", icon: "status" },
    );
  }
  return (
    <AppShell viewer={staff.viewer} nav={nav} brand={await brandFor(staff.tenantId)} wide>
      {staff.isPlatformAdmin && <TenantSwitcher tenants={staff.tenants} current={staff.tenantId} />}
      {children}
    </AppShell>
  );
}
