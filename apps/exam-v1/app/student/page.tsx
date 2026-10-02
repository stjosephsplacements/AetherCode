import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { examPhase, formatWhen } from "@/lib/exam-status";
import { AppShell } from "@/components/app-shell";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, Card, PageHeader, buttonClass } from "@/components/ui";
import Link from "next/link";
import { startExam } from "./actions";

export default async function StudentHome({ searchParams }: { searchParams: Promise<{ network?: string }> }) {
  const user = await requireUser("student");
  const { network } = await searchParams;
  const exams = await sql<
    Array<{ id: string; title: string; instructions: string; published: boolean; starts_at: Date; ends_at: Date; duration_minutes: number; questions: number; attempt_open: boolean | null }>
  >`
    SELECT e.id, e.title, e.instructions, e.published, e.starts_at, e.ends_at, e.duration_minutes,
      (SELECT count(DISTINCT eq.slot)::int FROM exam_questions eq WHERE eq.exam_id = e.id) AS questions,
      (a.finished_at IS NULL AND a.deadline_at > now()) AS attempt_open
    FROM exams e
    LEFT JOIN attempts a ON a.exam_id = e.id AND a.user_id = ${user.id}
    WHERE e.published AND ${user.batch} = ANY(e.batches) AND e.ends_at > now() - interval '14 days'
    ORDER BY e.starts_at`;

  return (
    <AppShell user={user}>
      <AutoRefresh seconds={30} />
      <PageHeader eyebrow={`Hello, ${user.name.split(" ")[0]}`} title="Your exams" />
      {network && (
        <p role="alert" className="mb-6 rounded-xl bg-error-soft px-4 py-3 text-sm font-medium text-error">
          This exam can only be taken from the exam lab network. Ask your invigilator for help.
        </p>
      )}
      <div className="grid gap-5">
        {exams.map((exam) => {
          const phase = examPhase(exam);
          const started = exam.attempt_open !== null;
          const done = started && !exam.attempt_open;
          return (
            <Card key={exam.id} className="grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  {done ? (
                    <Badge tone="pass">Submitted</Badge>
                  ) : phase === "live" ? (
                    <Badge tone="pass">● Open now</Badge>
                  ) : phase === "scheduled" ? (
                    <Badge tone="brand">Upcoming</Badge>
                  ) : (
                    <Badge tone="accent">Closed</Badge>
                  )}
                </div>
                <h2 className="font-display text-2xl font-semibold tracking-tight">{exam.title}</h2>
                <p className="mt-1 text-sm text-muted">
                  {exam.questions} question{exam.questions === 1 ? "" : "s"} · {exam.duration_minutes} minutes · window {formatWhen(exam.starts_at)} – {formatWhen(exam.ends_at)}
                </p>
                {exam.instructions && !done && <p className="mt-4 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-ink-soft">{exam.instructions}</p>}
              </div>
              <div>
                {exam.attempt_open ? (
                  <Link href={`/exam/${exam.id}`} className={buttonClass("go")}>
                    Resume exam →
                  </Link>
                ) : !started && phase === "live" ? (
                  <form action={startExam.bind(null, exam.id)}>
                    <button className={buttonClass("go")}>Start exam →</button>
                  </form>
                ) : null}
                {!started && phase === "live" && <p className="mt-2 max-w-48 text-xs text-faint">Your {exam.duration_minutes}-minute timer starts when you click.</p>}
              </div>
            </Card>
          );
        })}
        {exams.length === 0 && (
          <Card className="px-6 py-16 text-center">
            <p className="font-display text-xl font-semibold">No exams right now</p>
            <p className="mt-1 text-sm text-muted">When your faculty publishes an exam for your batch, it will appear here.</p>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
