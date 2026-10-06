import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { examPhase, formatWhen } from "@/lib/exam-status";
import { AppShell } from "@/components/app-shell";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, Card, PageHeader, buttonClass } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import Link from "next/link";
import { headers } from "next/headers";
import { publicOrigin } from "@/lib/public-url";
import { fromSebBrowser } from "@/lib/seb";
import { startExam } from "./actions";
import { SebLaunchButton } from "./seb-launch-button";

export default async function StudentHome({ searchParams }: { searchParams: Promise<{ network?: string; seb?: string }> }) {
  const user = await requireUser("student");
  const { network, seb } = await searchParams;
  // SEB maps seb:// to http:// and sebs:// to https://, so the scheme must follow the
  // app's own; sebs:// against a plain-http server makes SEB reject the link.
  const sebOrigin = (await publicOrigin()).replace(/^http/, "seb");
  // Only decides which button to show; the exam page itself verifies SEB.
  const insideSeb = fromSebBrowser(await headers());

  const exams = await sql<
    Array<{
      id: string;
      title: string;
      instructions: string;
      published: boolean;
      starts_at: Date;
      ends_at: Date;
      duration_minutes: number;
      questions: number;
      attempt_open: boolean | null;
      results_released: boolean;
      score: string | null;
      max_score: number | null;
      require_seb: boolean;
    }>
  >`
    SELECT e.id, e.title, e.instructions, e.published, e.starts_at, e.ends_at, e.duration_minutes,
      (SELECT count(DISTINCT eq.slot)::int FROM exam_questions eq WHERE eq.exam_id = e.id) AS questions,
      (a.finished_at IS NULL AND a.deadline_at > now()) AS attempt_open,
      e.results_released,
      (SELECT sum(ss.score) FROM slot_scores ss WHERE ss.attempt_id = a.id) AS score,
      (SELECT sum(points)::int FROM attempt_questions aq WHERE aq.attempt_id = a.id) AS max_score,
      e.require_seb
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
      {seb === "1" && (
        <p role="alert" className="mb-6 rounded-xl bg-error-soft px-4 py-3 text-sm font-medium text-error">
          This exam requires Safe Exam Browser (SEB). Please open it using the SEB application provided by your invigilator.
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
                {exam.instructions && !done && (
                  <div className="prose-exam mt-4 max-w-2xl text-ink-soft">
                    <Markdown>{exam.instructions}</Markdown>
                  </div>
                )}
              </div>
              <div>
                {done && exam.results_released ? (
                  <div className="text-right">
                    <p className="font-display text-3xl font-semibold tracking-tight">
                      {Number(exam.score ?? 0)} <span className="text-base font-normal text-muted">/ {exam.max_score}</span>
                    </p>
                    <Link href={`/student/results/${exam.id}`} className={`${buttonClass("secondary", "sm")} mt-2`}>
                      View results
                    </Link>
                  </div>
                ) : exam.attempt_open && exam.require_seb && !insideSeb ? (
                  <SebLaunchButton examId={exam.id} sebOrigin={sebOrigin} label="Resume in SEB →" />
                ) : exam.attempt_open ? (
                  <Link href={`/exam/${exam.id}`} className={buttonClass("go")}>
                    Resume exam →
                  </Link>
                ) : !started && phase === "live" ? (
                  exam.require_seb && !insideSeb ? (
                    <SebLaunchButton examId={exam.id} sebOrigin={sebOrigin} />
                  ) : (
                    <form action={startExam.bind(null, exam.id)}>
                      <button className={buttonClass("go")}>Start exam →</button>
                    </form>
                  )
                ) : null}
                {!started && phase === "live" && (
                  <p className="mt-2 max-w-48 text-xs text-faint">
                    {exam.require_seb && !insideSeb
                      ? "Requires Safe Exam Browser. Click to launch automatically."
                      : `Your ${exam.duration_minutes}-minute timer starts when you click.`}
                  </p>
                )}
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
