import { ArrowLeft } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { NavItem } from "@/components/nav-links";
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
  if (staff.isPlatformAdmin && !staff.tenantId) redirect("/admin/explore");
  const steps = staff.canManageAccounts ? await setupSteps(staff) : [];
  const locks = lockedPages(steps);
  /** Apply setup locks down the tree so nested leaves (batches, students, …) lock too. */
  const item = (entry: NavItem): NavItem => ({
    ...entry,
    locked: locks[entry.href] ?? entry.locked,
    children: entry.children?.map(item),
  });

  // Same order as get-started / setup: org → people → assess → ops.
  // Nest only where ownership is real (dept→batch, accounts→roles/permissions, exams→proctor/calendar).
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
        item({
          href: "/staff/departments",
          label: "Departments",
          icon: "organisation",
          children: [{ href: "/staff/departments/batches", label: "Batches", icon: "batch" }],
        }),
        item({
          href: "/staff/accounts",
          label: "Staff accounts",
          icon: "accounts",
          children: [
            { href: "/staff/roles", label: "Roles", icon: "roles" },
            { href: "/staff/permissions", label: "Permissions", icon: "accounts" },
          ],
        }),
        item({ href: "/staff/students", label: "Students", icon: "students" }),
        item({ href: "/staff/branding", label: "Branding", icon: "organisation" }),
      ],
    });
  }
  groups.push({
    label: "Assess",
    items: [
      item({ href: "/staff/questions", label: "Questions", icon: "questions" }),
      item({
        href: "/staff/exams",
        label: "Exams",
        icon: "exams",
        children: [
          { href: "/staff/proctor-policies", label: "Proctor policies", icon: "roles" },
          { href: "/staff/calendar", label: "Calendar", icon: "calendar" },
        ],
      }),
      { href: "/staff/analytics", label: "Analytics", icon: "analytics" },
      { href: "/staff/community", label: "Community", icon: "community" },
      { href: "/staff/contests", label: "Contests", icon: "contests" },
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
      consoleLabel="College workspace"
      brand={await brandFor(staff.tenantId)}
      college={
        staff.isPlatformAdmin ? (
          <Link
            href={staff.tenantId ? `/admin/explore?college=${encodeURIComponent(staff.tenantId)}` : "/admin/explore"}
            className="flex items-center gap-2 px-1 py-1 text-[13px] text-ink-muted transition-colors hover:text-ink"
          >
            <ArrowLeft className="size-3.5" />
            Back to explore
          </Link>
        ) : undefined
      }
    >
      {children}
      {steps.length > 0 && <GetStarted steps={steps.map(({ key, title, text, href, done, blocked }) => ({ key, title, text, href, done, blocked }))} userId={staff.viewer.principalId} />}
    </StaffShell>
  );
}
