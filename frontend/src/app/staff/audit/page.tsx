import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, LoadError, PageHeader, Table } from "@/components/staff/page-header";
import { CollegeFilter } from "@/components/staff/college-filter";
import { Badge } from "@/components/ui/card";
import type { AuditEntry } from "@/lib/api-types";
import { gateway } from "@/lib/server/gateway";
import { describeAccounts } from "@/lib/server/people";
import { inColleges } from "@/lib/server/colleges";
import { collegesFor, requireStaff } from "@/lib/server/staff";
import { auditAction } from "@/lib/audit";
import { LiveRefresh } from "@/lib/client/realtime";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string; college?: string }> }) {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect("/staff");
  const { before, college: collegeParam } = await searchParams;
  let data;
  try {
    // Each college returns its newest 100; together the newest 100 overall are the first 100 of the merged list.
    const perCollege = await inColleges(collegesFor(staff, collegeParam), async (collegeId) => {
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

  return (
    <>
      {!before && <LiveRefresh topics={["activity"]} />}
      <PageHeader
        title="Audit log"
        description={`Every change staff made in ${several ? "each college" : "this college"}, newest first, including attempts the platform refused. Kept for 400 days.`}
        actions={staff.isPlatformAdmin ? <CollegeFilter colleges={staff.tenants.map((tenant) => ({ id: tenant.id, name: tenant.display_name }))} /> : undefined}
      />
      {unreachable.length > 0 && <p role="alert" className="mb-4 text-sm text-warning">Could not load: {unreachable.join(", ")}.</p>}
      {entries.length === 0 ? (
        <EmptyState>{before ? "No older entries." : "No staff changes recorded yet."}</EmptyState>
      ) : (
        <>
          <Table head={several ? ["When", "College", "Who", "What", "On", "Outcome"] : ["When", "Who", "What", "On", "Outcome"]}>
            {entries.map((entry, index) => {
              const person = entry.person;
              return (
                <tr key={`${entry.occurred_at}-${index}`} className="border-t border-line">
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-muted">{formatDateTime(entry.occurred_at)}</td>
                  {several && <td className="px-4 py-2.5 text-ink-muted">{entry.collegeName}</td>}
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-ink">{person?.display_name ?? "Unknown account"}</span>
                    {person?.username && <span className="ml-1.5 font-mono text-xs text-ink-subtle">{person.username}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-ink">{auditAction(entry)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink-subtle" title={entry.resource_id}>{entry.resource_id.slice(0, 8)}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={entry.allowed ? "success" : "danger"}>{entry.allowed ? "Allowed" : "Refused"}</Badge>
                  </td>
                </tr>
              );
            })}
          </Table>
          {last && entries.length >= 100 && (
            <Link href={`/staff/audit?before=${encodeURIComponent(last.occurred_at)}${collegeParam ? `&college=${collegeParam}` : ""}`} className="mt-4 inline-block text-sm text-brand hover:underline">
              Older entries
            </Link>
          )}
        </>
      )}
    </>
  );
}
