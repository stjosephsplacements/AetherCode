import { type NavGroup } from "@/components/staff/staff-nav";
import { StaffShell } from "@/components/staff/staff-shell";
import { brandFor } from "@/lib/server/branding";
import { lockedPages, setupSteps } from "@/lib/server/setup";
import { requireStaff } from "@/lib/server/staff";
import { GetStarted } from "./get-started";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const steps = staff.canManageAccounts ? await setupSteps(staff) : [];
  const locks = lockedPages(steps);
  const item = <T extends { href: string }>(entry: T) => ({ ...entry, locked: locks[entry.href] });
  // Ordered the way things are created: a college first, then its departments and people, then questions and exams.
  const groups: NavGroup[] = [
    {
      label: "Overview",
      items: [
        { href: "/staff", label: "Dashboard", icon: "home" },
        ...(staff.canManageAccounts ? [{ href: "/staff/get-started", label: "Get started", icon: "start" } as const] : []),
      ],
    },
  ];
  if (staff.canManageAccounts) {
    groups.push({
      label: "Set up",
      items: [
        ...(staff.isPlatformAdmin ? [{ href: "/staff/colleges", label: "Colleges", icon: "organisation" } as const] : []),
        item({ href: "/staff/departments", label: "Departments", icon: "organisation" } as const),
        item({ href: "/staff/accounts", label: "Staff accounts", icon: "accounts" } as const),
        item({ href: "/staff/placements", label: "Placements", icon: "placements" } as const),
        item({ href: "/staff/students", label: "Students", icon: "students" } as const),
        item({ href: "/staff/permissions", label: "Permissions", icon: "accounts" } as const),
      ],
    });
  }
  groups.push({
    label: "Assess",
    items: [
      item({ href: "/staff/questions", label: "Questions", icon: "questions" } as const),
      item({ href: "/staff/exams", label: "Exams", icon: "exams" } as const),
      { href: "/staff/calendar", label: "Calendar", icon: "calendar" },
      { href: "/staff/analytics", label: "Analytics", icon: "analytics" },
      { href: "/staff/community", label: "Community", icon: "community" },
    ],
  });
  if (staff.canManageAccounts) {
    groups.push({
      label: "Platform",
      items: [
        { href: "/staff/audit", label: "Audit log", icon: "audit" },
        { href: "/staff/status", label: "System status", icon: "status" },
      ],
    });
  }
  groups.push({ label: "Help", items: [{ href: "/staff/help", label: "FAQ and guides", icon: "faq" }] });
  return (
    <StaffShell viewer={staff.viewer} tenantId={staff.tenantId} groups={groups} brand={await brandFor(staff.tenantId)}>
      {children}
      {steps.length > 0 && <GetStarted steps={steps.map(({ key, title, text, href, done, blocked }) => ({ key, title, text, href, done, blocked }))} userId={staff.viewer.principalId} />}
    </StaffShell>
  );
}
