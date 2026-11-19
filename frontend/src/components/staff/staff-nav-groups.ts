import type { NavGroup } from "@/components/staff/staff-nav";

/**
 * The pages of one college's workspace, ordered the way things are created: a college first, then its
 * departments and people, then questions and exams. `/staff` and the admin sidebar's "College workspace"
 * section both build from this. `locks` maps a page to why it cannot be used yet; `link` rewrites the
 * hrefs (the admin sidebar goes through /admin/open); `prefix` namespaces the group labels.
 */
export function staffNavGroups({
  canManageAccounts,
  locks = {},
  link = (path) => path,
  prefix = "",
}: {
  canManageAccounts: boolean;
  locks?: Record<string, string | undefined>;
  link?: (path: string) => string;
  prefix?: string;
}): NavGroup[] {
  const item = (path: string, label: string, icon: NavGroup["items"][number]["icon"]) => ({ href: link(path), label, icon, locked: locks[path] });
  const groups: NavGroup[] = [
    { label: "Overview", items: [item("/staff", "Dashboard", "home"), item("/staff/get-started", "Get started", "start")] },
  ];
  if (canManageAccounts) {
    groups.push({
      label: "Set up",
      items: [
        item("/staff/departments", "Departments", "organisation"),
        item("/staff/accounts", "Staff accounts", "accounts"),
        item("/staff/students", "Students", "students"),
        item("/staff/permissions", "Permissions", "accounts"),
        item("/staff/roles", "Roles", "roles"),
      ],
    });
  }
  groups.push({
    label: "Assess",
    items: [
      item("/staff/questions", "Questions", "questions"),
      item("/staff/exams", "Exams", "exams"),
      item("/staff/calendar", "Calendar", "calendar"),
      item("/staff/analytics", "Analytics", "analytics"),
      item("/staff/community", "Community", "community"),
    ],
  });
  if (canManageAccounts) {
    groups.push({ label: "Platform", items: [item("/staff/audit", "Audit log", "audit"), item("/staff/status", "System status", "status")] });
  }
  groups.push({ label: "Help", items: [item("/staff/help", "FAQ and guides", "faq")] });
  return prefix ? groups.map((group) => ({ ...group, label: `${prefix} · ${group.label}` })) : groups;
}
