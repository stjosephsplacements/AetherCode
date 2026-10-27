import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Panel, Badge } from "@/components/ui/card";
import { requireViewer } from "@/lib/server/session";
import { listMyAttempts } from "@/lib/server/attempts";
import { listAssignments } from "@/lib/server/assignments";
import { formatDateTime } from "@/lib/utils";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = { title: "Completed Assessments" };

export default async function CompletedAssessmentsPage() {
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");
  const [attempts, assignments] = await Promise.all([
    listMyAttempts(viewer.tenantId).catch(() => []),
    listAssignments(viewer.tenantId).catch(() => []),
  ]);

  const titles = new Map(assignments.map((a) => [a.id, a.title]));
  const finished = attempts.filter((a) => ["submitted", "grading", "graded"].includes(a.lifecycle_state));

  return (
    <div className="animate-enter space-y-6">
      <div>
        <span className="eyebrow text-brand">SUBMISSION ARCHIVE</span>
        <h1 className="display mt-1 text-[2.25rem] text-ink sm:text-[2.6rem]">Completed Assessments</h1>
        <p className="mt-2 text-[15px] text-ink-muted">
          Historical record of all finished coding tests, exam attempts, and evaluations.
        </p>
      </div>

      {finished.length === 0 ? (
        <Panel className="p-8 text-center border-line bg-surface/70">
          <p className="text-sm text-ink-muted">No completed assessments recorded yet.</p>
        </Panel>
      ) : (
        <div className="space-y-3">
          {finished.map((attempt) => (
            <Panel key={attempt.id} className="p-5 border-line bg-surface/80 transition-colors hover:border-brand/40">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone="success">Submitted</Badge>
                    <span className="text-xs text-ink-subtle">
                      {formatDateTime(attempt.submitted_at ?? attempt.submission_deadline)}
                    </span>
                  </div>
                  <h3 className="mt-2 text-base font-semibold text-ink">
                    {titles.get(attempt.candidate_assignment_id) ?? "Assessment Attempt"}
                  </h3>
                </div>
                <Link
                  href={`/student/results/${attempt.id}`}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline"
                >
                  Review Result <ArrowRight className="size-3.5" />
                </Link>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
