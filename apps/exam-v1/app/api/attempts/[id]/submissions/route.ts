import { z } from "zod";
import { handle, HttpError, questionInExam, requireOpenAttempt, requireStudent } from "@/lib/attempts";
import { sql } from "@/lib/db";

const body = z.object({
  questionId: z.string(),
  language: z.string(),
  source: z.string().min(1, "Write some code first.").max(65536, "Code is too long (64 KB max)."),
  kind: z.enum(["run", "submit"]),
  customInput: z.string().max(65536).nullable().optional(),
});

const MAX_PENDING = 2;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireStudent();
    const attempt = await requireOpenAttempt((await params).id, user);
    const parsed = body.safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
    const input = parsed.data;
    if (!attempt.languages.includes(input.language)) throw new HttpError(400, "That language is not allowed in this exam.");
    if (!(await questionInExam(attempt.examId, input.questionId))) throw new HttpError(404, "Question not found.");
    const [{ pending }] = await sql<{ pending: number }[]>`
      SELECT count(*)::int AS pending FROM submissions WHERE attempt_id = ${attempt.id} AND status IN ('queued', 'running')`;
    if (pending >= MAX_PENDING) throw new HttpError(429, "Your previous run is still being judged. Wait for it to finish.");
    const [created] = await sql<{ id: string }[]>`
      INSERT INTO submissions (attempt_id, question_id, kind, language, source, custom_input)
      VALUES (${attempt.id}, ${input.questionId}, ${input.kind}, ${input.language}, ${input.source},
        ${input.kind === "run" ? (input.customInput ?? null) : null})
      RETURNING id`;
    await sql`
      INSERT INTO drafts (attempt_id, question_id, language, source)
      VALUES (${attempt.id}, ${input.questionId}, ${input.language}, ${input.source})
      ON CONFLICT (attempt_id, question_id) DO UPDATE SET language = EXCLUDED.language, source = EXCLUDED.source, updated_at = now()`;
    return Response.json({ id: created.id }, { status: 202 });
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireStudent();
    const attemptId = (await params).id;
    const questionId = new URL(request.url).searchParams.get("questionId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(attemptId) || !/^[0-9a-f-]{36}$/i.test(questionId)) throw new HttpError(400, "Invalid request.");
    const rows = await sql`
      SELECT s.id, s.language, s.status, s.verdict, s.passed, s.total, s.created_at
      FROM submissions s JOIN attempts a ON a.id = s.attempt_id
      WHERE s.attempt_id = ${attemptId} AND a.user_id = ${user.id} AND s.question_id = ${questionId} AND s.kind = 'submit'
      ORDER BY s.created_at DESC LIMIT 20`;
    return Response.json({ submissions: rows });
  });
}
