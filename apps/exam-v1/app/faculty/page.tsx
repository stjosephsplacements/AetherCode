import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { examPhase, formatWhen, PHASE_TONE } from "@/lib/exam-status";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, PageHeader, buttonClass } from "@/components/ui";

export default async function FacultyHome() {
  const user = await requireUser("faculty", "admin");
  const exams = await sql<
    Array<{ id: string; title: string; published: boolean; starts_at: Date; ends_at: Date; duration_minutes: number; batches: string[]; questions: number; started: number }>
  >`
    SELECT e.id, e.title, e.published, e.starts_at, e.ends_at, e.duration_minutes, e.batches,
      (SELECT count(DISTINCT eq.slot)::int FROM exam_questions eq WHERE eq.exam_id = e.id) AS questions,
      (SELECT count(*)::int FROM attempts a WHERE a.exam_id = e.id) AS started
    FROM exams e ORDER BY e.starts_at DESC`;
  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="Assessments"
        title="Exams"
        actions={
          <>
            <Link href="/faculty/questions" className={buttonClass("secondary")}>
              Question bank
            </Link>
            <Link href="/faculty/exams/new" className={buttonClass()}>
              New exam
            </Link>
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {exams.map((exam) => {
          const phase = examPhase(exam);
          return (
            <Card key={exam.id} className="flex flex-col p-6">
              <div className="mb-3 flex items-center gap-2">
                <Badge tone={PHASE_TONE[phase]}>{phase === "live" ? "● Live" : phase}</Badge>
                <span className="text-xs text-faint">{exam.batches.join(", ")}</span>
              </div>
              <h2 className="font-display text-xl font-semibold tracking-tight">{exam.title}</h2>
              <p className="mt-1 text-sm text-muted">
                {formatWhen(exam.starts_at)} → {formatWhen(exam.ends_at)} · {exam.duration_minutes} min · {exam.questions} question
                {exam.questions === 1 ? "" : "s"}
              </p>
              <div className="mt-6 flex items-center gap-2">
                <span className="mr-auto text-sm">
                  <strong className="font-display text-lg">{exam.started}</strong> <span className="text-muted">started</span>
                </span>
                <Link href={`/faculty/exams/${exam.id}`} className={buttonClass("ghost", "sm")}>
                  Edit
                </Link>
                <Link href={`/faculty/exams/${exam.id}/results`} className={buttonClass("secondary", "sm")}>
                  {phase === "live" ? "Monitor" : "Results"}
                </Link>
              </div>
            </Card>
          );
        })}
      </div>
      {exams.length === 0 && (
        <Card className="px-6 py-16 text-center">
          <p className="font-display text-xl font-semibold">No exams yet</p>
          <p className="mt-1 text-sm text-muted">Add questions to the bank, then create an exam.</p>
        </Card>
      )}
    </AppShell>
  );
}
