import { ArrowRight, CheckCircle } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, PageHeader } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import { listAssignments } from "@/lib/server/assignments";
import { listMyAttempts } from "@/lib/server/attempts";
import { requireViewer } from "@/lib/server/session";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Completed" };

const STATE = { submitted: ["Submitted", "neutral"], grading: ["Being graded", "warning"], graded: ["Graded", "success"] } as const;

export default async function CompletedPage() {
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");
  const [attempts, assignments] = await Promise.all([listMyAttempts(viewer.tenantId).catch(() => []), listAssignments(viewer.tenantId).catch(() => [])]);
  const titles = new Map(assignments.map((assignment) => [assignment.id, assignment.title]));
  const finished = attempts
    .filter((attempt) => attempt.lifecycle_state in STATE)
    .sort((a, b) => (b.submitted_at ?? b.submission_deadline).localeCompare(a.submitted_at ?? a.submission_deadline));

  return (
    <div className="animate-enter">
      <PageHeader title="Completed" description="Every exam you have finished, newest first, with its result once it is released." />
      {finished.length === 0 ? (
        <EmptyState>
          <CheckCircle className="mx-auto mb-3 size-6 text-ink-subtle" />
          Exams you finish appear here.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface shadow-[var(--shadow-panel)]">
          {finished.map((attempt) => {
            const [label, tone] = STATE[attempt.lifecycle_state as keyof typeof STATE];
            return (
              <li key={attempt.id}>
                <Link href={`/student/results/${attempt.id}`} className="flex flex-wrap items-center gap-3 px-5 py-4 transition-colors hover:bg-hover">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="truncate text-[15px] font-medium text-ink">{titles.get(attempt.candidate_assignment_id) ?? "Exam"}</p>
                    <p className="mt-0.5 text-[12.5px] text-ink-muted">{formatDateTime(attempt.submitted_at ?? attempt.submission_deadline)}</p>
                  </div>
                  <Badge tone={tone}>{label}</Badge>
                  <span className="inline-flex items-center gap-1 text-[13px] font-medium text-brand">
                    View result <ArrowRight className="size-3.5" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
