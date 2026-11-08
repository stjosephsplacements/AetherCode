import type { Metadata } from "next";
import Link from "next/link";
import { ServicesBadge } from "@/components/staff/live-services";
import { PageHeader } from "@/components/staff/page-header";
import { Tile } from "@/components/staff/tile";
import { collegeHref } from "@/lib/links";
import { requireAdmin } from "@/lib/server/staff";
import { serviceHealth } from "@/lib/server/status";

export const metadata: Metadata = { title: "Admin" };

const LINKS = [
  { href: "/admin/incidents", title: "Incidents", text: "What needs attention now, and emergency controls for open exams." },
  { href: "/admin/colleges", title: "Colleges", text: "Add, edit and remove the colleges on this platform." },
  { href: "/admin/admins", title: "Administrators", text: "Who holds platform-wide access, and what they may do." },
  { href: "/staff/permissions?scope=platform", title: "Permissions", text: "Grant extra permissions to staff beyond what their role allows." },
  { href: "/admin/analytics", title: "Analytics", text: "Load and health of every service, live." },
  { href: "/admin/status", title: "System status", text: "Service health and the judge queue." },
  { href: "/admin/audit", title: "Audit log", text: "Every staff change, in every college." },
  { href: "/placement", title: "Placements", text: "Which students are in each placement track, across all colleges." },
  { href: "/placement/departments", title: "Placement departments", text: "Organisations (like PEP, HOPE) and the departments they run." },
];

export default async function AdminHome() {
  const staff = await requireAdmin();
  const health = staff.tenants[0] ? await serviceHealth(staff.tenants[0].id).catch(() => null) : null;
  return (
    <>
      <PageHeader title="Admin console" description="Platform-level settings. Open a college below to work inside it." actions={<ServicesBadge initial={health} />} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Tile label="Colleges">
          <p className="font-mono text-[2rem] font-semibold leading-none text-ink">{staff.tenants.length}</p>
          <p className="mt-2 text-[13px] text-ink-muted">on this platform</p>
        </Tile>
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="rounded-[var(--radius-surface)] border border-line bg-surface p-5 transition-shadow hover:shadow-[var(--shadow-panel)]">
            <p className="text-[15px] font-semibold text-ink">{link.title}</p>
            <p className="mt-1 text-[13px] leading-snug text-ink-muted">{link.text}</p>
          </Link>
        ))}
      </div>

      <h2 className="mb-3 mt-10 text-[15px] font-semibold tracking-[-0.01em] text-ink">College workspaces</h2>
      <p className="mb-3 text-[13px] text-ink-muted">Departments, students, questions and exams for one college. Open one to work inside it.</p>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {staff.tenants.map((tenant) => (
          <li key={tenant.id}>
            <Link href={collegeHref("/staff", tenant.id)} className="flex items-center justify-between gap-3 rounded-[var(--radius-surface)] border border-line bg-surface px-4 py-3 transition-shadow hover:shadow-[var(--shadow-panel)]">
              <span className="truncate text-[14.5px] font-medium text-ink">{tenant.display_name}</span>
              <span className="shrink-0 text-[13px] text-brand">Open workspace</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
