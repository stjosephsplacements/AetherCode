import { ArrowLeft } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { type NavGroup } from "@/components/staff/staff-nav";
import { StaffShell } from "@/components/staff/staff-shell";
import { requirePlacement } from "@/lib/server/placement";

/** The placement area: students of every college a placement department reaches. Separate from /staff, which is one college. */
export default async function PlacementLayout({ children }: { children: React.ReactNode }) {
  const placement = await requirePlacement();
  const groups: NavGroup[] = [
    {
      label: "Placement",
      items: [
        { href: "/placement", label: "Placements", icon: "placements" },
        { href: "/placement/departments", label: "Departments", icon: "organisation" },
        { href: "/placement/staff", label: "Officers", icon: "accounts" },
      ],
    },
    {
      label: "Assess",
      items: [
        { href: "/placement/questions", label: "Questions", icon: "questions" },
        { href: "/placement/exams", label: "Exams", icon: "exams" },
      ],
    },
  ];
  return (
    <StaffShell
      viewer={placement.viewer}
      tenantId={placement.colleges[0]?.id ?? null}
      groups={groups}
      home="/placement"
      college={
        placement.isPlatformAdmin ? (
          <Link href="/admin" className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-[13px] text-ink-muted transition-colors hover:bg-hover hover:text-ink">
            <ArrowLeft className="size-3.5" />
            Back to admin
          </Link>
        ) : undefined
      }
    >
      {children}
    </StaffShell>
  );
}
