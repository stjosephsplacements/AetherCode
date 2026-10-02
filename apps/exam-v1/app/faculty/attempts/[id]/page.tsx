import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { formatWhen } from "@/lib/exam-status";
import { LANGUAGES, isLanguageId } from "@/lib/languages";
import { examQuestions } from "@/lib/results";
import { VERDICT_LABEL, VERDICT_TONE } from "@/lib/verdicts";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, PageHeader, buttonClass } from "@/components/ui";
import { extendAttempt } from "../../actions";

export default async function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("faculty", "admin");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [attempt] = await sql<
    Array<{ exam_id: string; exam_title: string; username: string; name: string; batch: string | null; started_at: Date; deadline_at: Date; finished_at: Date | null }>
  >`
    SELECT a.exam_id, e.title AS exam_title, u.username, u.name, u.batch, a.started_at, a.deadline_at, a.finished_at
    FROM attempts a JOIN exams e ON e.id = a.exam_id JOIN users u ON u.id = a.user_id WHERE a.id = ${id}`;
  if (!attempt) notFound();
  const questions = await examQuestions(attempt.exam_id);
  const submissions = await sql<
    Array<{ id: string; question_id: string; kind: string; language: string; source: string; status: string; verdict: string | null; passed: number; total: number; earned_weight: number; total_weight: number; created_at: Date }>
  >`
    SELECT id, question_id, kind, language, source, status, verdict, passed, total, earned_weight, total_weight, created_at
    FROM submissions WHERE attempt_id = ${id} AND kind = 'submit' ORDER BY created_at DESC`;
  const drafts = await sql<{ question_id: string; language: string; source: string; updated_at: Date }[]>`
    SELECT question_id, language, source, updated_at FROM drafts WHERE attempt_id = ${id}`;
  const events = await sql<{ kind: string; at: Date }[]>`SELECT kind, at FROM attempt_events WHERE attempt_id = ${id} ORDER BY at`;
  const live = !attempt.finished_at && attempt.deadline_at > new Date();

  return (
    <AppShell user={user}>
      <Link href={`/faculty/exams/${attempt.exam_id}/results`} className="mb-4 inline-block text-sm text-muted hover:text-ink">
        ← {attempt.exam_title}
      </Link>
      <PageHeader eyebrow={`${attempt.username} · ${attempt.batch ?? ""}`} title={attempt.name} />
      <div className="mb-8 grid gap-4 md:grid-cols-[1fr_auto]">
        <Card className="flex flex-wrap gap-x-8 gap-y-2 p-5 text-sm">
          <span>
            <span className="text-faint">Started</span> {formatWhen(attempt.started_at)}
          </span>
          <span>
            <span className="text-faint">Deadline</span> {formatWhen(attempt.deadline_at)}
          </span>
          <span>
            <span className="text-faint">Finished</span> {attempt.finished_at ? formatWhen(attempt.finished_at) : live ? "In progress" : "Time ran out"}
          </span>
          <span>
            <span className="text-faint">Focus lost</span> {events.length}×
          </span>
        </Card>
        <Card className="p-5">
          <form action={extendAttempt.bind(null, id)} className="flex items-center gap-2">
            <span className="text-sm font-semibold">Extra time</span>
            <input name="minutes" type="number" min={1} max={240} defaultValue={10} className="w-20 rounded-lg border border-line-strong px-2 py-1.5 text-sm" />
            <span className="text-sm text-muted">min</span>
            <button className={buttonClass("secondary", "sm")}>Grant</button>
          </form>
        </Card>
      </div>

      {questions.map((question, index) => {
        const mine = submissions.filter((submission) => submission.question_id === question.id);
        const best = mine.reduce<number | null>((top, submission) => {
          if (submission.status !== "done" || submission.total_weight === 0) return top;
          const score = Math.round((question.points * submission.earned_weight * 100) / submission.total_weight) / 100;
          return top === null || score > top ? score : top;
        }, null);
        const latest = mine[0];
        const draft = drafts.find((entry) => entry.question_id === question.id);
        const shown = latest ?? draft;
        return (
          <section key={question.id} className="mb-10">
            <div className="mb-3 flex flex-wrap items-baseline gap-3">
              <h2 className="font-display text-xl font-semibold tracking-tight">
                Q{index + 1}. {question.title}
              </h2>
              <span className="text-sm text-muted">
                Best score <strong className="text-ink">{best ?? 0}</strong> / {question.points}
              </span>
            </div>
            {mine.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {mine.map((submission) => (
                  <Badge key={submission.id} tone={submission.status === "done" ? VERDICT_TONE[submission.verdict ?? ""] ?? "neutral" : "neutral"}>
                    {submission.created_at.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} ·{" "}
                    {submission.status === "done" ? `${VERDICT_LABEL[submission.verdict ?? ""] ?? submission.verdict} ${submission.passed}/${submission.total}` : submission.status}
                  </Badge>
                ))}
              </div>
            )}
            {shown ? (
              <Card className="overflow-hidden">
                <p className="border-b border-line bg-sunken px-4 py-2 text-xs text-muted">
                  {latest ? "Latest submission" : "Unsubmitted draft"} · {isLanguageId(shown.language) ? LANGUAGES[shown.language].label : shown.language}
                </p>
                <pre className="max-h-[28rem] overflow-auto p-4 font-mono text-[13px] leading-relaxed">{shown.source}</pre>
              </Card>
            ) : (
              <p className="text-sm text-muted">No code written.</p>
            )}
          </section>
        );
      })}

      {events.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-xl font-semibold tracking-tight">Focus events</h2>
          <Card className="p-4 text-sm text-muted">
            {events.map((event, index) => (
              <span key={index} className="mr-4 inline-block">
                {event.at.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} {event.kind.replace("_", " ")}
              </span>
            ))}
          </Card>
        </section>
      )}
    </AppShell>
  );
}
