import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, LoadError, PageHeader, Table } from "@/components/staff/page-header";
import { CollegeBar } from "@/components/staff/college-bar";
import { Badge } from "@/components/ui/card";
import type { AuditEntry } from "@/lib/api-types";
import { gateway } from "@/lib/server/gateway";
import { describeAccounts } from "@/lib/server/people";
import { requireCollege } from "@/lib/server/staff";
import { auditAction } from "@/lib/audit";
import { LiveRefresh } from "@/lib/client/realtime";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const staff = await requireCollege();
  if (!staff.canManageAccounts) redirect("/staff");
  const { before } = await searchParams;
  let data;
  try {
    const entries = await gateway<AuditEntry[]>(`/user/v1/tenants/${staff.tenantId}/staff-audit${before ? `?before=${encodeURIComponent(before)}` : ""}`);
    const names = entries.length ? await describeAccounts(staff.tenantId, entries.map((entry) => entry.principal_id)).catch(() => new Map()) : new Map();
    data = { entries, names };
  } catch (error) {
    return (
      <>
        <CollegeBar staff={staff} />
      <PageHeader title="Audit log" />
        <LoadError error={error} />
      </>
    );
  }
  const { entries, names } = data;
  const last = entries.at(-1);

  return (
    <>
      {!before && <LiveRefresh topics={["activity"]} />}
      <CollegeBar staff={staff} />
      <PageHeader
        title="Audit log"
        description="Every change staff made in this college, newest first, including attempts the platform refused. Kept for 400 days."
      />
      {entries.length === 0 ? (
        <EmptyState>{before ? "No older entries." : "No staff changes recorded yet."}</EmptyState>
      ) : (
        <>
          <Table head={["When", "Who", "What", "On", "Outcome"]}>
            {entries.map((entry, index) => {
              const person = names.get(entry.principal_id);
              return (
                <tr key={`${entry.occurred_at}-${index}`} className="border-t border-line">
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-muted">{formatDateTime(entry.occurred_at)}</td>
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
            <Link href={`/staff/audit?before=${encodeURIComponent(last.occurred_at)}`} className="mt-4 inline-block text-sm text-brand hover:underline">
              Older entries
            </Link>
          )}
        </>
      )}
    </>
  );
}
