import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { sql } from "@/lib/db";
import { ipAllowed } from "@/lib/net";
import type { LanguageId } from "@/lib/languages";
import { buttonClass, Logo } from "@/components/ui";
import { ExamIde, type IdeQuestion } from "./exam-ide";

export const dynamic = "force-dynamic";

export default async function ExamPage({ params }: { params: Promise<{ examId: string }> }) {
  const user = await requireUser("student");
  const { examId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(examId)) notFound();
  const [attempt] = await sql<
    Array<{
      id: string;
      title: string;
      languages: LanguageId[];
      deadline_at: Date;
      open: boolean;
      allowed_networks: string[];
      require_fullscreen: boolean;
      block_external_paste: boolean;
    }>
  >`
    SELECT a.id, e.title, e.languages, a.deadline_at, (a.finished_at IS NULL AND a.deadline_at > now()) AS open,
      e.allowed_networks, e.require_fullscreen, e.block_external_paste
    FROM attempts a JOIN exams e ON e.id = a.exam_id
    WHERE a.exam_id = ${examId} AND a.user_id = ${user.id}`;
  if (!attempt) redirect("/student");
  if (attempt.open && !ipAllowed(await clientIp(), attempt.allowed_networks)) redirect("/student?network=1");

  if (!attempt.open) {
    return (
      <main className="relative isolate grid min-h-dvh place-items-center px-4">
        <div className="hero-glow absolute inset-0 -z-10 opacity-60" />
        <div className="max-w-md text-center">
          <Logo className="mb-8" />
          <h1 className="font-display text-4xl font-semibold tracking-tight">Exam submitted</h1>
          <p className="mt-3 text-muted">
            Your answers for <strong className="text-ink">{attempt.title}</strong> have been recorded. Your best submission for each question
            counts. You can close this window.
          </p>
          <Link href="/student" className={`${buttonClass("secondary")} mt-8`}>
            Back to my exams
          </Link>
        </div>
      </main>
    );
  }

  const questions = await sql<Array<{ id: string; title: string; statement: string; points: number; time_limit_ms: number; memory_limit_kb: number }>>`
    SELECT q.id, q.title, q.statement, aq.points, q.time_limit_ms, q.memory_limit_kb
    FROM attempt_questions aq JOIN questions q ON q.id = aq.question_id
    WHERE aq.attempt_id = ${attempt.id} ORDER BY aq.slot`;
  const samples = await sql<Array<{ question_id: string; input: string; expected_output: string }>>`
    SELECT t.question_id, t.input, t.expected_output FROM test_cases t
    JOIN attempt_questions aq ON aq.question_id = t.question_id AND aq.attempt_id = ${attempt.id}
    WHERE t.is_sample ORDER BY t.ord`;
  const drafts = await sql<Array<{ question_id: string; language: LanguageId; source: string }>>`
    SELECT question_id, language, source FROM drafts WHERE attempt_id = ${attempt.id}`;
  const best = await sql<Array<{ question_id: string; passed: number; total: number }>>`
    SELECT DISTINCT ON (question_id) question_id, passed, total FROM submissions
    WHERE attempt_id = ${attempt.id} AND kind = 'submit' AND status = 'done'
    ORDER BY question_id, (passed::numeric / nullif(total, 0)) DESC NULLS LAST`;

  const ideQuestions: IdeQuestion[] = questions.map((question) => ({
    id: question.id,
    title: question.title,
    statement: question.statement,
    points: question.points,
    timeLimitMs: question.time_limit_ms,
    memoryLimitMb: Math.round(question.memory_limit_kb / 1024),
    samples: samples.filter((sample) => sample.question_id === question.id).map((sample) => ({ input: sample.input, expected: sample.expected_output })),
    draft: drafts.find((draft) => draft.question_id === question.id) ?? null,
    best: best.find((entry) => entry.question_id === question.id) ?? null,
  }));

  return (
    <ExamIde
      attemptId={attempt.id}
      title={attempt.title}
      studentName={user.name}
      username={user.username}
      languages={attempt.languages}
      deadline={attempt.deadline_at.toISOString()}
      serverNow={new Date().toISOString()}
      questions={ideQuestions}
      requireFullscreen={attempt.require_fullscreen}
      blockExternalPaste={attempt.block_external_paste}
    />
  );
}
