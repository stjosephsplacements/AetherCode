import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { panel } from "@/app/admin/_dashboard/panel";
import { ActionForm, Field, TextInput } from "@/components/staff/form";
import { EmptyState, LoadError, PageHeader, Table } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import type { FailedGradingJobsPage } from "@/lib/api-types";
import { gateway } from "@/lib/server/gateway";
import { requireCollege } from "@/lib/server/staff";
import { cn } from "@/lib/utils";
import { dismissFailedJob, retryAllFailedJobs, retryFailedJob } from "./actions";

export const metadata: Metadata = { title: "Failed grading" };

export default async function FailedGradingPage() {
  const staff = await requireCollege();
  if (!staff.canManageAccounts) redirect("/staff/status");

  let data: FailedGradingJobsPage;
  try {
    data = await gateway<FailedGradingJobsPage>(`/submission/v1/tenants/${staff.tenantId}/grading-queue/failed?limit=100`);
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Failed grading" />
        <LoadError error={error} />
      </div>
    );
  }

  return (
    <div className="animate-enter space-y-6">
      <PageHeader
        title="Failed grading"
        description={`${data.total} open failure${data.total === 1 ? "" : "s"}. Summaries never include candidate source.`}
        actions={
          data.total > 0 ? (
            <ActionForm action={retryAllFailedJobs} submitLabel="Retry all" className="inline">
              <span className="sr-only">Retry every open failure</span>
            </ActionForm>
          ) : null
        }
      />
      <p className="text-sm text-ink-muted">
        <Link href="/staff/status" className="text-brand hover:underline">
          ← System status
        </Link>
      </p>

      {data.items.length === 0 ? (
        <EmptyState>No open failures.</EmptyState>
      ) : (
        <section className={cn(panel, "p-0")}>
          <Table head={["When", "Kind", "Summary", "Tries", ""]}>
            {data.items.map((job) => (
              <tr key={job.id}>
                <td className="px-4 py-2.5 font-mono text-[12px] text-ink-muted">
                  {job.failed_at ? new Date(job.failed_at).toLocaleString() : "—"}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone="warning">{job.kind}</Badge>
                </td>
                <td className="max-w-md px-4 py-2.5 text-[13px] text-ink">{job.error_summary}</td>
                <td className="px-4 py-2.5 font-mono text-[13px]">{job.dispatch_attempts}</td>
                <td className="space-y-2 px-4 py-2.5">
                  <ActionForm action={retryFailedJob} submitLabel="Retry" className="inline">
                    <input type="hidden" name="job_id" value={job.id} />
                  </ActionForm>
                  <ActionForm action={dismissFailedJob} submitLabel="Dismiss" className="space-y-1">
                    <input type="hidden" name="job_id" value={job.id} />
                    <Field label="Reason" htmlFor={`reason-${job.id}`}>
                      <TextInput id={`reason-${job.id}`} name="reason" required maxLength={500} placeholder="Why dismiss?" />
                    </Field>
                  </ActionForm>
                </td>
              </tr>
            ))}
          </Table>
        </section>
      )}
    </div>
  );
}
