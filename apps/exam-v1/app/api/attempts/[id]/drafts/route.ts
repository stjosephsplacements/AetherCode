import { z } from "zod";
import { handle, HttpError, questionInExam, requireOpenAttempt, requireStudent } from "@/lib/attempts";
import { DRAFT_GRACE_SECONDS } from "@/lib/attempt-rules";
import { sql } from "@/lib/db";

const body = z.object({ questionId: z.string(), language: z.string(), source: z.string().max(65536) });

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireStudent();
    const attempt = await requireOpenAttempt((await params).id, user, DRAFT_GRACE_SECONDS);
    const parsed = body.safeParse(await request.json());
    if (!parsed.success || !attempt.languages.includes(parsed.data.language)) throw new HttpError(400, "Invalid draft.");
    if (!(await questionInExam(attempt.examId, parsed.data.questionId))) throw new HttpError(404, "Question not found.");
    await sql`
      INSERT INTO drafts (attempt_id, question_id, language, source)
      VALUES (${attempt.id}, ${parsed.data.questionId}, ${parsed.data.language}, ${parsed.data.source})
      ON CONFLICT (attempt_id, question_id) DO UPDATE SET language = EXCLUDED.language, source = EXCLUDED.source, updated_at = now()`;
    return Response.json({ ok: true });
  });
}
