import { ArrowLeft, CalendarClock, Clock3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { listAssignments } from "@/lib/server/assignments";
import { requireCollege } from "@/lib/server/staff";
import { formatDuration, formatWindow } from "@/lib/utils";
import { StartExam } from "@/app/student/(shell)/exams/[assignmentId]/start-exam";

export const metadata: Metadata = { title: "Try an exam" };

/** The lobby of a staff member's private copy of an exam (ADR-0046). */
export default async function TryExamPage({ params }: { params: Promise<{ examId: string; assignmentId: string }> }) {
  const { examId, assignmentId } = await params;
  const staff = await requireCollege();
  let assignment;
  try {
    assignment = (await listAssignments(staff.tenantId)).find((candidate) => candidate.id === assignmentId);
  } catch (error) {
    return (
      <>
        <PageHeader title="Try an exam" />
        <LoadError error={error} />
      </>
    );
  }
  if (!assignment) notFound();

  return (
    <div className="mx-auto max-w-[680px]">
      <Link href={`/staff/exams/${examId}`} className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        This private copy
      </Link>
      <p className="mt-6 rounded-[var(--radius-control)] bg-brand-soft px-4 py-2 text-sm text-brand-soft-ink">
        You are trying a private copy. Your marks are in its results, not in the real exam&apos;s. When you finish you return to the staff area; your result is under{" "}
        <Link href={`/staff/exams/${examId}/results`} className="underline">
          this copy&apos;s results
        </Link>
        .
      </p>
      <h1 className="display mt-8 text-[2.1rem] text-ink">{assignment.title}</h1>
      <div className="mt-4 flex flex-wrap gap-2 text-[13px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1">
          <CalendarClock className="size-3.5" strokeWidth={1.75} />
          {formatWindow(assignment.available_from, assignment.available_until)}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1">
          <Clock3 className="size-3.5" strokeWidth={1.75} />
          {formatDuration(assignment.duration_seconds)}
        </span>
      </div>
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Instructions</h2>
        <Markdown>{assignment.instructions_markdown}</Markdown>
      </section>
      <StartExam assignment={assignment} />
    </div>
  );
}
