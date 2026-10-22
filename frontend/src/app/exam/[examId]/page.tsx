import { redirect } from "next/navigation";
import { Panel } from "@/components/ui/card";
import { assignmentForExam, listAssignments } from "@/lib/server/assignments";
import { requireViewer } from "@/lib/server/session";

// Safe Exam Browser's start page (the .seb launch file opens /exam/<exam id>).
// It sends the student on to their assignment for that exam.
export default async function ExamEntry({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  const viewer = await requireViewer();
  const assignments = viewer.tenantId ? await listAssignments(viewer.tenantId) : [];
  const target = assignmentForExam(assignments, examId);
  if (target) redirect(`/student/exams/${target.id}`);

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <Panel className="max-w-md animate-enter p-8 text-center">
        <h1 className="display text-[1.75rem] text-ink">This exam isn’t assigned to you</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          You are signed in as {viewer.username}. If that is not you, quit Safe Exam Browser and start it again; otherwise ask your
          invigilator.
        </p>
      </Panel>
    </main>
  );
}
