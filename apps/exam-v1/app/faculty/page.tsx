import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { examPhase, formatWhen, PHASE_TONE } from "@/lib/exam-status";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, PageHeader, buttonClass, inputClass } from "@/components/ui";
import { Pagination } from "@/components/pagination";

const PAGE_SIZE = 25;

export default async function FacultyHome({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  const user = await requireUser("faculty", "admin");
  const { page: pageStr = "1", q = "" } = await searchParams;
  const page = Math.max(1, Number(pageStr) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const hasSearch = q.trim() !== "";
  const pattern = `%${q.trim().toLowerCase()}%`;

  const [{ total }] = await sql<{ total: number }[]>`
    SELECT count(*)::int AS total FROM exams WHERE (${!hasSearch} OR lower(title) LIKE ${pattern})`;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const exams = await sql<
    Array<{ id: string; title: string; published: boolean; starts_at: Date; ends_at: Date; duration_minutes: number; batches: string[]; questions: number; started: number }>
  >`
    SELECT e.id, e.title, e.published, e.starts_at, e.ends_at, e.duration_minutes, e.batches,
      (SELECT count(DISTINCT eq.slot)::int FROM exam_questions eq WHERE eq.exam_id = e.id) AS questions,
      (SELECT count(*)::int FROM attempts a WHERE a.exam_id = e.id AND NOT a.is_preview) AS started
    FROM exams e
    WHERE (${!hasSearch} OR lower(e.title) LIKE ${pattern})
    ORDER BY e.starts_at DESC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}`;

  function buildHref(p: number) {
    const params = new URLSearchParams();
    if (p > 1) params.set("page", String(p));
    if (q) params.set("q", q);
    const qs = params.toString();
    return `/faculty${qs ? `?${qs}` : ""}`;
  }

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
      <form className="mb-6">
        <input name="q" defaultValue={q} placeholder="Search exams by title…" className={`${inputClass} max-w-md`} />
      </form>
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
          <p className="font-display text-xl font-semibold">{hasSearch ? "No exams match" : "No exams yet"}</p>
          <p className="mt-1 text-sm text-muted">{hasSearch ? "Try a different search." : "Add questions to the bank, then create an exam."}</p>
        </Card>
      )}
      <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
    </AppShell>
  );
}
