"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { QuestionSchema, checkVerification, contentHash } from "@/lib/question";
import { requireViewer } from "@/lib/session";

export type SaveResult = { error: string } | { id: string };

/** Saves a question only with proof that this exact content passed the judge (see /api/verify). */
export async function saveQuestion(id: string | null, payload: unknown, token: string): Promise<SaveResult> {
  const { viewer } = await requireViewer();
  const parsed = QuestionSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues.map((issue) => issue.message).join(" ") };
  const question = parsed.data;
  const hash = contentHash(question);
  if (!token || !checkVerification(token, hash, viewer.principalId)) {
    return { error: "Verify the question with the judge first. Any change after verifying needs verifying again." };
  }
  try {
    const savedId = await sql.begin(async (tx) => {
      let questionId = id;
      if (questionId) {
        const updated = await tx`
          UPDATE questions SET title = ${question.title}, difficulty = ${question.difficulty}, topics = ${question.topics},
            statement_md = ${question.statement_md}, input_format = ${question.input_format}, output_format = ${question.output_format},
            constraints_md = ${question.constraints_md}, time_limit_ms = ${question.time_limit_ms}, memory_limit_kb = ${question.memory_limit_kb},
            verified_hash = ${hash}, verified_at = now(), updated_by_principal_id = ${viewer.principalId}, updated_at = now()
          WHERE id = ${questionId} RETURNING id`;
        if (updated.length === 0) throw new Error("not_found");
        await tx`DELETE FROM question_tests WHERE question_id = ${questionId}`;
        await tx`DELETE FROM question_solutions WHERE question_id = ${questionId}`;
      } else {
        const created = await tx`
          INSERT INTO questions (title, difficulty, topics, statement_md, input_format, output_format, constraints_md, time_limit_ms, memory_limit_kb,
            verified_hash, author_principal_id, author_name, updated_by_principal_id)
          VALUES (${question.title}, ${question.difficulty}, ${question.topics}, ${question.statement_md}, ${question.input_format}, ${question.output_format},
            ${question.constraints_md}, ${question.time_limit_ms}, ${question.memory_limit_kb}, ${hash}, ${viewer.principalId}, ${viewer.name}, ${viewer.principalId})
          RETURNING id`;
        questionId = created[0]!.id as string;
      }
      for (const [position, test] of question.tests.entries()) {
        await tx`INSERT INTO question_tests (question_id, position, input, expected_output, is_sample) VALUES (${questionId}, ${position}, ${test.input}, ${test.expected_output}, ${test.is_sample})`;
      }
      for (const solution of question.solutions) {
        await tx`INSERT INTO question_solutions (question_id, language, source) VALUES (${questionId}, ${solution.language}, ${solution.source})`;
      }
      await tx`UPDATE verifications SET question_id = ${questionId} WHERE id = (SELECT id FROM verifications WHERE content_hash = ${hash} AND run_by_principal_id = ${viewer.principalId} AND passed ORDER BY run_at DESC LIMIT 1)`;
      return questionId as string;
    });
    revalidatePath("/");
    return { id: savedId };
  } catch (error) {
    if (error instanceof Error && error.message === "not_found") return { error: "That question no longer exists." };
    if (error instanceof Error && /questions_title_key/.test(error.message)) return { error: "A question with this title already exists." };
    throw error;
  }
}

export async function deleteQuestion(id: string) {
  const { viewer } = await requireViewer();
  const [row] = await sql`SELECT author_principal_id FROM questions WHERE id = ${id}`;
  const admin = viewer.roles.some((role) => role === "super_admin" || role === "college_admin");
  if (!row || (row.author_principal_id !== viewer.principalId && !admin)) return;
  await sql`DELETE FROM questions WHERE id = ${id}`;
  revalidatePath("/");
  redirect("/");
}
