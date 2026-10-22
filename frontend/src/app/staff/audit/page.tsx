import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, LoadError, PageHeader, Table } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import type { AuditEntry } from "@/lib/api-types";
import { gateway } from "@/lib/server/gateway";
import { describeAccounts } from "@/lib/server/people";
import { requireCollege } from "@/lib/server/staff";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit log" };

/** What a write on each resource means, in staff terms (ADR-0043). */
const ACTIONS: Record<string, string> = {
  "submission/attempt_events": "Gave extra time or posted an announcement",
  "submission/score_summaries": "Released results, regraded, or changed exam integrity",
  "submission/attempts": "Changed a student's attempt",
  "assessment/exams": "Created or duplicated an exam",
  "assessment/exam_versions": "Edited or published an exam",
  "assessment/exam_sections": "Edited an exam's sections or pools",
  "assessment/exam_items": "Edited an exam's questions or repinned one",
  "assessment/assignment_rules": "Assigned an exam or moved its window",
  "assessment/proctor_policies": "Changed a lockdown policy",
  "assessment/proctor_policy_versions": "Changed a lockdown policy",
  "question-bank/questions": "Created, archived or moved a question between tests and practice",
  "question-bank/question_versions": "Edited, checked or published a question",
  "question-bank/test_case_manifests": "Changed a question's tests",
  "question-bank/question_exports": "Exported a question with its hidden tests",
  "question-bank/question_version_tags": "Changed a question's tags",
  "question-bank/question_assets": "Added a file to a question",
  "user/accounts": "Imported students, reset a password, or turned sign-in on or off",
  "user/students": "Changed a student's record",
  "user/role_assignments": "Gave or removed a staff role",
  "user/mentor_batch_assignments": "Assigned a mentor to a batch",
  "user/student_batch_affiliations": "Moved a student between batches",
  "tenant/departments": "Changed a department",
  "tenant/batches": "Created or changed a batch",
  "seb/configurations": "Changed Safe Exam Browser settings",
  "seb/key_rotations": "Rotated a Safe Exam Browser key",
};

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
        <PageHeader title="Audit log" />
        <LoadError error={error} />
      </>
    );
  }
  const { entries, names } = data;
  const last = entries.at(-1);

  return (
    <>
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
                  <td className="px-4 py-2.5 text-ink">{ACTIONS[`${entry.service}/${entry.resource_type}`] ?? `Changed ${entry.resource_type.replaceAll("_", " ")} (${entry.service})`}</td>
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
