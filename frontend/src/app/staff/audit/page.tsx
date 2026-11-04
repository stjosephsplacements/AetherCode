import { Scroll, ShieldCheck, ShieldWarning, Users } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { EmptyState, LoadError, PageHeader } from "@/components/staff/page-header";
import type { AuditEntry } from "@/lib/api-types";
import { gateway } from "@/lib/server/gateway";
import { describeAccounts } from "@/lib/server/people";
import { inColleges } from "@/lib/server/colleges";
import { collegesFor, requireStaff } from "@/lib/server/staff";
import { auditAction } from "@/lib/audit";
import { LiveRefresh } from "@/lib/client/realtime";
import { TIME_ZONE, formatDateTime } from "@/lib/utils";
import { AuditLog, type AuditRow } from "./audit-log";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string; college?: string }> }) {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect("/staff");
  const { before, college: collegeParam } = await searchParams;
  let data;
  try {
    // Each college returns its newest 100; together the newest 100 overall are the first 100 of the merged list.
    const perCollege = await inColleges(collegesFor(staff), async (collegeId) => {
      const found = await gateway<AuditEntry[]>(`/user/v1/tenants/${collegeId}/staff-audit${before ? `?before=${encodeURIComponent(before)}` : ""}`);
      const people = found.length ? await describeAccounts(collegeId, found.map((entry) => entry.principal_id)).catch(() => new Map()) : new Map();
      return { found, people };
    });
    const entries = perCollege
      .flatMap(({ college, value }) => (value?.found ?? []).map((entry) => ({ ...entry, collegeName: college.name, person: value?.people.get(entry.principal_id) })))
      .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
      .slice(0, 100);
    data = { entries, unreachable: perCollege.filter((entry) => entry.failed).map((entry) => entry.college.name) };
  } catch (error) {
    return (
      <>
      <PageHeader title="Audit log" />
        <LoadError error={error} />
      </>
    );
  }
  const { entries, unreachable } = data;
  const several = staff.isPlatformAdmin;
  const last = entries.at(-1);
  const dayOf = new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeOf = new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true });
  const rows: AuditRow[] = entries.map((entry, index) => ({
    key: `${entry.occurred_at}-${index}`,
    at: formatDateTime(entry.occurred_at),
    day: dayOf.format(new Date(entry.occurred_at)),
    time: timeOf.format(new Date(entry.occurred_at)),
    college: entry.collegeName,
    who: entry.person?.display_name ?? (entry.principal_id === staff.viewer.principalId ? staff.viewer.displayName : "Unknown account"),
    username: entry.person?.username ?? (entry.principal_id === staff.viewer.principalId ? staff.viewer.username : ""),
    what: auditAction(entry),
    on: entry.resource_id.slice(0, 8),
    resource: entry.resource_id,
    allowed: entry.allowed,
  }));
  const chip = (icon: ReactNode, label: string, value: number) => (
    <li className="inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-2.5 pr-3 text-[13px] text-ink-muted">
      <span aria-hidden className="text-brand">{icon}</span>
      {label}
      <span className="font-mono tabular-nums text-ink">{value}</span>
    </li>
  );

  return (
    <>
      {!before && <LiveRefresh topics={["activity"]} />}
      <PageHeader
        title="Audit log"
        description={`Every change staff made in ${several ? "each college" : "this college"}, newest first, including attempts the platform refused. Kept for 400 days.`}
      />
      {unreachable.length > 0 && <p role="alert" className="mb-4 text-sm text-warning">Could not load: {unreachable.join(", ")}.</p>}
      <ul className="mb-5 flex flex-wrap gap-2" aria-label="Summary">
        {chip(<Scroll className="size-3.5" />, "Entries loaded", entries.length)}
        {chip(<ShieldCheck className="size-3.5" />, "Allowed", entries.filter((entry) => entry.allowed).length)}
        {chip(<ShieldWarning className="size-3.5" />, "Refused", entries.filter((entry) => !entry.allowed).length)}
        {chip(<Users className="size-3.5" />, "People", new Set(entries.map((entry) => entry.principal_id)).size)}
      </ul>
      {entries.length === 0 ? (
        <EmptyState>{before ? "No older entries." : "No staff changes recorded yet."}</EmptyState>
      ) : (
        <>
          <AuditLog rows={rows} several={several} />
          {last && entries.length >= 100 && (
            <Link href={`?before=${encodeURIComponent(last.occurred_at)}${collegeParam ? `&college=${collegeParam}` : ""}`} className="mt-4 inline-block text-sm text-brand hover:underline">
              Older entries
            </Link>
          )}
        </>
      )}
    </>
  );
}
