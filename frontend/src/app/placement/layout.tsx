import { type NavGroup } from "@/components/staff/staff-nav";
import { StaffShell } from "@/components/staff/staff-shell";
import { requirePlacement } from "@/lib/server/placement";

/** Placement staff console: assigned tracks only (ADR-0089). Setup lives under /admin/placement. */
export default async function PlacementLayout({ children }: { children: React.ReactNode }) {
  const placement = await requirePlacement();
  const groups: NavGroup[] = [
    {
      label: "Overview",
      items: [
        { href: "/placement", label: "Placements", icon: "placements" },
        { href: "/placement/drives", label: "Drives", icon: "contests" },
        { href: "/placement/get-started", label: "Get started", icon: "start" },
      ],
    },
    {
      label: "Students",
      items: [{ href: "/placement/students", label: "Students", icon: "accounts" }],
    },
    {
      label: "Assess",
      items: [
        { href: "/placement/questions", label: "Questions", icon: "questions" },
        { href: "/placement/exams", label: "Exams", icon: "exams" },
        { href: "/placement/analytics", label: "Analytics", icon: "analytics" },
      ],
    },
    {
      label: "Community",
      items: [{ href: "/placement/community", label: "Blogs", icon: "blogs" }],
    },
  ];
  return (
    <StaffShell
      viewer={placement.viewer}
      tenantId={placement.colleges[0]?.id ?? null}
      groups={groups}
      home="/placement"
      consoleLabel="Placement"
    >
      {children}
    </StaffShell>
  );
}
