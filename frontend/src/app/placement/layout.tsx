import { ArrowLeft, Buildings } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { type NavGroup } from "@/components/staff/staff-nav";
import { StaffShell } from "@/components/staff/staff-shell";
import { requirePlacement } from "@/lib/server/placement";

/** The placement area: students of every college the officer's roles reach. Separate from /staff, which is one college. */
export default async function PlacementLayout({ children }: { children: React.ReactNode }) {
  const placement = await requirePlacement();
  const groups: NavGroup[] = [
    {
      label: "All colleges",
      items: [
        { href: "/placement", label: "Placements", icon: "placements" },
        { href: "/placement/get-started", label: "Get started", icon: "start" },
      ],
    },
  ];
  // Departments and officers are managed across colleges, so only a viewer whose reach is every college gets them.
  if (placement.allColleges) {
    groups.push({
      label: "Manage",
      items: [
        { href: "/placement/departments", label: "Departments", icon: "organisation" },
        { href: "/placement/staff", label: "Officers", icon: "accounts" },
      ],
    });
  }
  groups.push({
    label: "Assess across colleges",
    items: [
      { href: "/placement/questions", label: "Questions", icon: "questions" },
      { href: "/placement/exams", label: "Exams", icon: "exams" },
      { href: "/placement/analytics", label: "Analytics", icon: "analytics" },
    ],
  });
  const count = placement.colleges.length;
  return (
    <StaffShell
      viewer={placement.viewer}
      tenantId={placement.colleges[0]?.id ?? null}
      groups={groups}
      home="/placement"
      college={
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[13px] text-ink">
            <Buildings className="size-3.5 shrink-0 text-ink-subtle" />
            <span className="truncate">{placement.allColleges ? `All colleges (${count})` : `${count} ${count === 1 ? "college" : "colleges"}`}</span>
          </div>
          {placement.isPlatformAdmin && (
            <Link href="/admin" className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-[13px] text-ink-muted transition-colors hover:bg-hover hover:text-ink">
              <ArrowLeft className="size-3.5" />
              Back to admin
            </Link>
          )}
        </div>
      }
    >
      {children}
    </StaffShell>
  );
}
