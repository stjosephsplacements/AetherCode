import { z } from "zod";
import { DRAFT_GRACE_SECONDS } from "@/lib/attempt-rules";
import { handle, HttpError, questionInAttempt, requireExamTaker, requireOpenAttempt } from "@/lib/attempts";
import { sql } from "@/lib/db";
import { validSelection } from "@/lib/mcq";

const body = z.object({ questionId: z.string(), selected: z.array(z.number().int()).max(10) });

// Saves a multiple-choice answer (indexes into the question's original option
// order). Accepted briefly after the deadline, like code drafts.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireExamTaker();
    const attempt = await requireOpenAttempt((await params).id, user, DRAFT_GRACE_SECONDS);
    const parsed = body.safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400, "Invalid answer.");
    const { questionId, selected } = parsed.data;
    if (!(await questionInAttempt(attempt.id, questionId))) throw new HttpError(404, "Question not found.");
    const [question] = await sql<{ options: number; multiple: boolean }[]>`
      SELECT array_length(mcq_options, 1) AS options, array_length(mcq_correct, 1) > 1 AS multiple
      FROM questions WHERE id = ${questionId} AND kind = 'mcq'`;
    if (!question || !validSelection(selected, question.options, question.multiple)) throw new HttpError(400, "Invalid answer.");
    await sql`
      INSERT INTO mcq_answers (attempt_id, question_id, selected)
      VALUES (${attempt.id}, ${questionId}, ${selected})
      ON CONFLICT (attempt_id, question_id) DO UPDATE SET selected = EXCLUDED.selected, updated_at = now()`;
    return Response.json({ ok: true });
  });
}
