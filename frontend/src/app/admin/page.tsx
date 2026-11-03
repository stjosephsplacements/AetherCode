import type { Metadata } from "next";
import Link from "next/link";
import { ServicesBadge } from "@/components/staff/live-services";
import { PageHeader } from "@/components/staff/page-header";
import { Tile } from "@/components/staff/tile";
import { requireAdmin } from "@/lib/server/staff";
import { serviceHealth } from "@/lib/server/status";

export const metadata: Metadata = { title: "Admin" };

const LINKS = [
  { href: "/admin/incidents", title: "Incidents", text: "What needs attention now, and emergency controls for open exams." },
  { href: "/admin/colleges", title: "Colleges", text: "Add, edit and remove the colleges on this platform." },
  { href: "/admin/admins", title: "Administrators", text: "Who holds platform-wide access, and what they may do." },
  { href: "/admin/analytics", title: "Analytics", text: "Load and health of every service, live." },
  { href: "/admin/status", title: "System status", text: "Service health and the judge queue." },
  { href: "/admin/audit", title: "Audit log", text: "Every staff change, in every college." },
  { href: "/staff", title: "College workspace", text: "Departments, students, questions and exams for one college." },
];

export default async function AdminHome() {
  const staff = await requireAdmin();
  const health = staff.tenantId ? await serviceHealth(staff.tenantId).catch(() => null) : null;
  return (
    <>
      <PageHeader title="Admin console" description="Everything that spans colleges. Work inside one college from its workspace." actions={<ServicesBadge initial={health} />} />
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
    </>
  );
}
