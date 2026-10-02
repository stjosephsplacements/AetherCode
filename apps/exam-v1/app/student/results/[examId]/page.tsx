import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { VERDICT_LABEL, VERDICT_TONE } from "@/lib/verdicts";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function StudentResultsPage({ params }: { params: Promise<{ examId: string }> }) {
  const user = await requireUser("student");
  const { examId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(examId)) notFound();
  // Only for released exams whose attempt is over.
  const [attempt] = await sql<{ id: string; title: string }[]>`
    SELECT a.id, e.title FROM attempts a JOIN exams e ON e.id = a.exam_id
    WHERE a.exam_id = ${examId} AND a.user_id = ${user.id} AND e.results_released
      AND (a.finished_at IS NOT NULL OR a.deadline_at <= now())`;
  if (!attempt) notFound();
  const slots = await sql<
    Array<{ slot: number; title: string; points: number; submission_id: string | null; score: string | null; passed: number | null; total: number | null; verdict: string | null }>
  >`
    SELECT aq.slot, q.title, aq.points, best.id AS submission_id, best.score, best.passed, best.total, best.verdict
    FROM attempt_questions aq
    JOIN questions q ON q.id = aq.question_id
    LEFT JOIN LATERAL (
      SELECT s.id, round(aq.points * s.earned_weight::numeric / nullif(s.total_weight, 0), 2) AS score, s.passed, s.total, s.verdict
      FROM submissions s
      WHERE s.attempt_id = aq.attempt_id AND s.question_id = aq.question_id AND s.kind = 'submit' AND s.status = 'done'
      ORDER BY s.earned_weight::numeric / nullif(s.total_weight, 0) DESC NULLS LAST, s.created_at DESC
      LIMIT 1
    ) best ON true
    WHERE aq.attempt_id = ${attempt.id}
    ORDER BY aq.slot`;
  const tests = await sql<{ submission_id: string; ord: number; is_sample: boolean; verdict: string }[]>`
    SELECT submission_id, ord, is_sample, verdict FROM submission_results
    WHERE submission_id = ANY(${slots.map((slot) => slot.submission_id).filter((id): id is string => id !== null)})
    ORDER BY ord`;
  const total = slots.reduce((sum, slot) => sum + Number(slot.score ?? 0), 0);
  const max = slots.reduce((sum, slot) => sum + slot.points, 0);

  return (
    <AppShell user={user}>
      <Link href="/student" className="mb-4 inline-block text-sm text-muted hover:text-ink">
        ← My exams
      </Link>
      <PageHeader eyebrow="Your result" title={attempt.title} />
      <Card className="mb-8 flex items-baseline gap-3 p-6">
        <span className="font-display text-5xl font-semibold tracking-tight">{Math.round(total * 100) / 100}</span>
        <span className="text-lg text-muted">/ {max}</span>
      </Card>
      <div className="grid gap-4">
        {slots.map((slot) => (
          <Card key={slot.slot} className="p-5">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="font-display text-lg font-semibold tracking-tight">
                Q{slot.slot + 1}. {slot.title}
              </h2>
              <span className="ml-auto text-sm">
                <strong className="text-ink">{slot.score === null ? 0 : Number(slot.score)}</strong> <span className="text-muted">/ {slot.points}</span>
              </span>
            </div>
            {slot.submission_id ? (
              <>
                <p className="mt-1 text-sm text-muted">
                  Best submission: {slot.passed}/{slot.total} test cases · {VERDICT_LABEL[slot.verdict ?? ""] ?? slot.verdict}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {tests
                    .filter((test) => test.submission_id === slot.submission_id)
                    .map((test) => (
                      <Badge key={test.ord} tone={VERDICT_TONE[test.verdict] ?? "neutral"}>
                        {test.is_sample ? "Sample" : "Test"} {test.ord}: {VERDICT_LABEL[test.verdict] ?? test.verdict}
                      </Badge>
                    ))}
                </div>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted">No submission.</p>
            )}
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
