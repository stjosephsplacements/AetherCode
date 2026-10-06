import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { sql } from "@/lib/db";
import { optionOrder } from "@/lib/mcq";
import { ipAllowed } from "@/lib/net";
import { publicOrigin } from "@/lib/public-url";
import { fromSebBrowser, isSebConfigKeyRequest } from "@/lib/seb";
import { SebLaunchButton } from "@/app/student/seb-launch-button";
import type { LanguageId } from "@/lib/languages";
import { buttonClass, Logo } from "@/components/ui";
import { ExamIde, type IdeQuestion } from "./exam-ide";
import { HardNavigate } from "./hard-navigate";
import { SebCheck } from "./seb-check";

export const dynamic = "force-dynamic";

export default async function ExamPage({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<{ seb?: string }>;
}) {
  const user = await requireUser();
  const staff = user.role !== "student";
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
      require_seb: boolean;
    }>
  >`
    SELECT a.id, e.title, e.languages, a.deadline_at, (a.finished_at IS NULL AND a.deadline_at > now()) AS open,
      e.allowed_networks, e.require_fullscreen, e.block_external_paste, e.require_seb
    FROM attempts a JOIN exams e ON e.id = a.exam_id
    -- Staff only ever see their own preview attempt.
    WHERE a.exam_id = ${examId} AND a.user_id = ${user.id} AND a.is_preview = ${staff}`;
  if (!attempt) redirect(staff ? `/faculty/exams/${examId}` : "/student");
  if (!staff && attempt.open && !ipAllowed(await clientIp(), attempt.allowed_networks)) redirect("/student?network=1");
  let quitUrl: string | undefined;
  if (!staff && attempt.open && attempt.require_seb) {
    const origin = await publicOrigin();
    const hdrs = await headers();
    // A normal browser can never pass the check below: send the student to SEB.
    if (!user.sebVerified && !fromSebBrowser(hdrs)) {
      return (
        <main className="grid min-h-dvh place-items-center px-4 text-center">
          <div className="max-w-md">
            <Logo className="mb-8" />
            <h1 className="font-display text-3xl font-semibold tracking-tight">Continue in Safe Exam Browser</h1>
            <p className="mt-3 text-muted">
              <strong className="text-ink">{attempt.title}</strong> runs only in Safe Exam Browser. It is opening now; if your browser asks, allow it
              to open SEB. Your timer keeps running and your saved code is waiting there.
            </p>
            <div className="mt-8 flex justify-center gap-3">
              <SebLaunchButton examId={examId} sebOrigin={origin.replace(/^http/, "seb")} label="Open in SEB →" autoLaunch />
              <Link href="/student" className={buttonClass("secondary")}>
                Back to my exams
              </Link>
            </div>
          </div>
        </main>
      );
    }
    const retried = (await searchParams).seb === "reload";
    const requestUrl = `${origin}/exam/${examId}${retried ? "?seb=reload" : ""}`;
    const configKeyHash = hdrs.get("x-safeexambrowser-configkeyhash");
    if (!user.sebVerified && !isSebConfigKeyRequest(requestUrl, configKeyHash, origin)) {
      // SEB hashes the exact URL it requests. A client-side navigation or the Start
      // button's server-action redirect is requested under another URL, so the hash
      // cannot match here; load the page as a full document once. If the header is
      // still missing (SEB for macOS never sends it), verify via the JavaScript API.
      if (!retried) return <HardNavigate href={`/exam/${examId}?seb=reload`} />;
      return <SebCheck examHref={`/exam/${examId}`} />;
    }
    quitUrl = `${origin}/student?seb=quit`;
  }

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
          <Link href={staff ? `/faculty/exams/${examId}` : "/student"} className={`${buttonClass("secondary")} mt-8`}>
            {staff ? "Back to the exam editor" : "Back to my exams"}
          </Link>
        </div>
      </main>
    );
  }

  const questions = await sql<
    Array<{
      id: string;
      title: string;
      statement: string;
      points: number;
      time_limit_ms: number;
      memory_limit_kb: number;
      kind: "coding" | "mcq";
      mcq_options: string[] | null;
      multiple: boolean | null;
    }>
  >`
    -- Correct answers are never selected here; only whether there is more than one.
    SELECT q.id, q.title, q.statement, aq.points, q.time_limit_ms, q.memory_limit_kb, q.kind, q.mcq_options,
      array_length(q.mcq_correct, 1) > 1 AS multiple
    FROM attempt_questions aq JOIN questions q ON q.id = aq.question_id
    WHERE aq.attempt_id = ${attempt.id} ORDER BY aq.slot`;
  const samples = await sql<Array<{ question_id: string; input: string; expected_output: string }>>`
    SELECT t.question_id, t.input, t.expected_output FROM test_cases t
    JOIN attempt_questions aq ON aq.question_id = t.question_id AND aq.attempt_id = ${attempt.id}
    WHERE t.is_sample ORDER BY t.ord`;
  const drafts = await sql<Array<{ question_id: string; language: LanguageId; source: string }>>`
    SELECT question_id, language, source FROM drafts WHERE attempt_id = ${attempt.id}`;
  const answers = await sql<Array<{ question_id: string; selected: number[] }>>`
    SELECT question_id, selected FROM mcq_answers WHERE attempt_id = ${attempt.id}`;
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
    mcq:
      question.kind === "mcq" && question.mcq_options
        ? {
            multiple: Boolean(question.multiple),
            // Shown in this student's own shuffled order; values stay original indexes.
            options: optionOrder(question.mcq_options.length, `${attempt.id}:${question.id}`).map((index) => ({
              index,
              text: question.mcq_options![index],
            })),
            selected: answers.find((answer) => answer.question_id === question.id)?.selected ?? [],
          }
        : null,
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
      preview={staff}
      requireFullscreen={attempt.require_fullscreen}
      blockExternalPaste={attempt.block_external_paste}
      quitUrl={quitUrl}
      insideSeb={quitUrl !== undefined}
    />
  );
}
