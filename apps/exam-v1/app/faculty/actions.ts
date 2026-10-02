"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { OUTPUT_LIMIT_BYTES } from "@/lib/batch";
import { LANGUAGE_IDS } from "@/lib/languages";
import { isValidNetwork } from "@/lib/net";

const questionInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  statement: z.string().trim().min(1, "Problem statement is required").max(50_000),
  timeLimitMs: z.coerce.number().int().min(100).max(20_000),
  memoryLimitMb: z.coerce.number().int().min(16).max(1024),
  tests: z
    .array(
      z.object({
        input: z.string().max(2_000_000),
        // The judge captures at most this much output per test (lib/batch.ts).
        expectedOutput: z.string().max(OUTPUT_LIMIT_BYTES, "Expected output must be under 256 KB per test"),
        isSample: z.boolean(),
        weight: z.coerce.number().int().min(1).max(100),
      }),
    )
    .min(1, "Add at least one test case")
    .max(100),
});

export type QuestionInput = z.input<typeof questionInput>;

export async function saveQuestion(id: string | null, input: QuestionInput): Promise<{ error?: string }> {
  const user = await requireUser("faculty", "admin");
  const parsed = questionInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const question = parsed.data;
  if (!question.tests.some((test) => test.isSample)) return { error: "Mark at least one test case as a sample so students can Run." };

  const questionId = await sql.begin(async (tx) => {
    let questionId = id;
    if (questionId) {
      const updated = await tx`
        UPDATE questions SET title = ${question.title}, statement = ${question.statement},
          time_limit_ms = ${question.timeLimitMs}, memory_limit_kb = ${question.memoryLimitMb * 1024}, updated_at = now()
        WHERE id = ${questionId} RETURNING id`;
      if (updated.length === 0) throw new Error("question not found");
      await tx`DELETE FROM test_cases WHERE question_id = ${questionId}`;
    } else {
      const [created] = await tx<{ id: string }[]>`
        INSERT INTO questions (title, statement, time_limit_ms, memory_limit_kb, created_by)
        VALUES (${question.title}, ${question.statement}, ${question.timeLimitMs}, ${question.memoryLimitMb * 1024}, ${user.id})
        RETURNING id`;
      questionId = created.id;
    }
    await tx`INSERT INTO test_cases ${tx(
      question.tests.map((test, ord) => ({
        question_id: questionId,
        ord,
        input: test.input,
        expected_output: test.expectedOutput,
        is_sample: test.isSample,
        weight: test.weight,
      })),
    )}`;
    return questionId as string;
  });
  revalidatePath("/faculty/questions");
  redirect(`/faculty/questions/${questionId}?saved=1`);
}

// Re-queues every final submission for a question, e.g. after fixing a test case.
export async function regradeQuestion(questionId: string): Promise<void> {
  await requireUser("faculty", "admin");
  await sql`
    UPDATE submissions SET status = 'queued', tries = 0, claimed_at = NULL
    WHERE question_id = ${questionId} AND kind = 'submit' AND status IN ('done', 'error')`;
  revalidatePath(`/faculty/questions/${questionId}`);
}

const examInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  instructions: z.string().max(20_000),
  startsAt: z.string().min(1, "Start time is required"),
  endsAt: z.string().min(1, "End time is required"),
  durationMinutes: z.coerce.number().int().min(1).max(1440),
  languages: z.array(z.enum(LANGUAGE_IDS as [string, ...string[]])).min(1, "Pick at least one language"),
  batches: z.array(z.string().trim().min(1).max(64)).min(1, "Pick at least one batch"),
  published: z.boolean(),
  allowedNetworks: z.array(z.string().trim().refine(isValidNetwork, "Networks must be IPv4 addresses or ranges like 10.20.0.0/16")).max(50),
  requireFullscreen: z.boolean(),
  blockExternalPaste: z.boolean(),
  questions: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        points: z.coerce.number().int().min(1).max(1000),
        slot: z.coerce.number().int().min(0).max(1000),
      }),
    )
    .min(1, "Add at least one question")
    .max(50),
});

export type ExamInput = z.input<typeof examInput>;

export async function saveExam(id: string | null, input: ExamInput): Promise<{ error?: string }> {
  const user = await requireUser("faculty", "admin");
  const parsed = examInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const exam = parsed.data;
  // The browser sends ISO strings with an explicit offset, so this parse is timezone-safe.
  const startsAt = new Date(exam.startsAt);
  const endsAt = new Date(exam.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return { error: "Invalid start or end time" };
  if (endsAt <= startsAt) return { error: "The window must end after it starts" };
  if (new Set(exam.questions.map((question) => question.questionId)).size !== exam.questions.length) {
    return { error: "A question appears twice" };
  }
  // Renumber slots 0..n-1 in order; every question in a pool is worth the same.
  const slotOrder = [...new Set(exam.questions.map((question) => question.slot))].sort((a, b) => a - b);
  for (const slot of slotOrder) {
    if (new Set(exam.questions.filter((question) => question.slot === slot).map((question) => question.points)).size > 1) {
      return { error: "Questions in the same pool must be worth the same points" };
    }
  }

  const examId = await sql.begin(async (tx) => {
    let examId = id;
    if (examId) {
      const started = await tx`SELECT 1 FROM attempts WHERE exam_id = ${examId} LIMIT 1`;
      const updated = await tx`
        UPDATE exams SET title = ${exam.title}, instructions = ${exam.instructions}, starts_at = ${startsAt},
          ends_at = ${endsAt}, duration_minutes = ${exam.durationMinutes}, languages = ${exam.languages},
          batches = ${exam.batches}, published = ${exam.published}, allowed_networks = ${exam.allowedNetworks},
          require_fullscreen = ${exam.requireFullscreen}, block_external_paste = ${exam.blockExternalPaste}
        WHERE id = ${examId} RETURNING id`;
      if (updated.length === 0) throw new Error("exam not found");
      // Once students have started, the question set is frozen; timing and access stay editable.
      if (started.length > 0) return examId;
      await tx`DELETE FROM exam_questions WHERE exam_id = ${examId}`;
    } else {
      const [created] = await tx<{ id: string }[]>`
        INSERT INTO exams (title, instructions, starts_at, ends_at, duration_minutes, languages, batches, published,
          allowed_networks, require_fullscreen, block_external_paste, created_by)
        VALUES (${exam.title}, ${exam.instructions}, ${startsAt}, ${endsAt}, ${exam.durationMinutes}, ${exam.languages},
          ${exam.batches}, ${exam.published}, ${exam.allowedNetworks}, ${exam.requireFullscreen}, ${exam.blockExternalPaste}, ${user.id})
        RETURNING id`;
      examId = created.id;
    }
    await tx`INSERT INTO exam_questions ${tx(
      exam.questions.map((question, ord) => ({
        exam_id: examId,
        question_id: question.questionId,
        ord,
        slot: slotOrder.indexOf(question.slot),
        points: question.points,
      })),
    )}`;
    return examId as string;
  });
  revalidatePath("/faculty");
  redirect(`/faculty/exams/${examId}?saved=1`);
}

// Gives one student extra minutes, e.g. after a machine failure.
export async function extendAttempt(attemptId: string, form: FormData): Promise<void> {
  await requireUser("faculty", "admin");
  const minutes = Number(form.get("minutes"));
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) return;
  await sql`
    UPDATE attempts SET deadline_at = greatest(deadline_at, now()) + make_interval(mins => ${minutes}), finished_at = NULL, finalized_at = NULL
    WHERE id = ${attemptId}`;
  revalidatePath(`/faculty/attempts/${attemptId}`);
}

export async function announce(examId: string, _: unknown, form: FormData): Promise<{ error?: string; ok?: boolean }> {
  const user = await requireUser("faculty", "admin");
  const message = String(form.get("message") ?? "").trim();
  if (message.length === 0 || message.length > 1000) return { error: "Write a message under 1000 characters." };
  await sql`INSERT INTO announcements (exam_id, message, created_by) VALUES (${examId}, ${message}, ${user.id})`;
  revalidatePath(`/faculty/exams/${examId}/results`);
  return { ok: true };
}

export async function setResultsReleased(examId: string, released: boolean): Promise<void> {
  await requireUser("faculty", "admin");
  await sql`UPDATE exams SET results_released = ${released} WHERE id = ${examId}`;
  revalidatePath(`/faculty/exams/${examId}/results`);
}
