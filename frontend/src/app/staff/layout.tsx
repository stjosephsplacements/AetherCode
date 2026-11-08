import { ArrowLeft } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { type NavGroup } from "@/components/staff/staff-nav";
import { StaffShell } from "@/components/staff/staff-shell";
import { brandFor } from "@/lib/server/branding";
import { lockedPages, setupSteps } from "@/lib/server/setup";
import { requireStaff } from "@/lib/server/staff";
import { GetStarted } from "./get-started";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  // A platform administrator works across colleges in /admin; /staff is one college's workspace,
  // opened on purpose from there (/admin/open).
  if (staff.isPlatformAdmin && !staff.tenantId) redirect("/admin");
  const steps = staff.canManageAccounts ? await setupSteps(staff) : [];
  const locks = lockedPages(steps);
  const item = <T extends { href: string }>(entry: T) => ({ ...entry, locked: locks[entry.href] });
  // Ordered the way things are created: a college first, then its departments and people, then questions and exams.
  const groups: NavGroup[] = [
    {
      label: "Overview",
      items: [
        { href: "/staff", label: "Dashboard", icon: "home" },
        { href: "/staff/get-started", label: "Get started", icon: "start" },
      ],
    },
  ];
  if (staff.canManageAccounts) {
    groups.push({
      label: "Set up",
      items: [
        item({ href: "/staff/departments", label: "Departments", icon: "organisation" } as const),
        item({ href: "/staff/accounts", label: "Staff accounts", icon: "accounts" } as const),
        item({ href: "/staff/students", label: "Students", icon: "students" } as const),
        item({ href: "/staff/permissions", label: "Permissions", icon: "accounts" } as const),
        { href: "/staff/roles", label: "Roles", icon: "roles" },
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
    <StaffShell
      viewer={staff.viewer}
      tenantId={staff.tenantId}
      groups={groups}
      brand={await brandFor(staff.tenantId)}
      college={
        staff.isPlatformAdmin ? (
          <Link href="/admin" className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-[13px] text-ink-muted transition-colors hover:bg-hover hover:text-ink">
            <ArrowLeft className="size-3.5" />
            Back to admin
          </Link>
        ) : undefined
      }
    >
      {children}
      {steps.length > 0 && <GetStarted steps={steps.map(({ key, title, text, href, done, blocked }) => ({ key, title, text, href, done, blocked }))} userId={staff.viewer.principalId} />}
    </StaffShell>
  );
}
