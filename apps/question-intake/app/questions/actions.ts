"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { QuestionSchema, checkVerification, contentHash, normalizeQuestion } from "@/lib/question";
import { requireViewer } from "@/lib/session";

export type SaveResult = { error: string } | { id: string; topicId: string };

/**
 * Saves a question in the platform's shape. A coding question needs proof that this exact content passed the judge
 * (see /api/verify); a multiple-choice question has nothing to run. The statement is converted to the platform's
 * format on the way in.
 */
export async function saveQuestion(id: string | null, payload: unknown, token: string | null): Promise<SaveResult> {
  const { viewer } = await requireViewer();
  const parsed = QuestionSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues.map((issue) => issue.message).join(" ") };
  const question = normalizeQuestion(parsed.data);
  const coding = question.kind === "coding";
  const hash = coding ? contentHash(parsed.data) : null;
  if (coding && (!token || !checkVerification(token, hash!, viewer.principalId))) {
    return { error: "Verify the question with the judge first. Any change after verifying needs verifying again." };
  }
  const [topic] = await sql`SELECT id FROM categories WHERE id = ${question.topic_id}`;
  if (!topic) return { error: "That topic no longer exists. Choose another." };
  const [clash] = await sql`SELECT id FROM questions WHERE slug = ${question.slug} AND id IS DISTINCT FROM ${id}`;
  if (clash) return { error: `The slug "${question.slug}" is taken. Change the title or type another slug under Advanced.` };
  try {
    const savedId = await sql.begin(async (tx) => {
      let questionId = id;
      const values = {
        slug: question.slug, category_id: question.topic_id, kind: question.kind, audience: question.audience, tags: question.tags,
        title: question.title, prompt_markdown: question.prompt_markdown, difficulty: question.difficulty,
        supported_languages: question.languages, time_limit_ms: question.time_limit_ms, memory_limit_kib: question.memory_limit_kib,
        choices: coding ? null : question.choices, correct_choices: coding ? null : question.correct_choices,
        multiple_choice: !coding && question.multiple_choice,
        choice_explanations: coding ? null : question.choice_explanations,
        verified_hash: hash,
      };
      if (questionId) {
        const updated = await tx`
          UPDATE questions SET slug = ${values.slug}, category_id = ${values.category_id}, audience = ${values.audience}, tags = ${values.tags},
            title = ${values.title}, prompt_markdown = ${values.prompt_markdown}, difficulty = ${values.difficulty},
            supported_languages = ${values.supported_languages}, time_limit_ms = ${values.time_limit_ms}, memory_limit_kib = ${values.memory_limit_kib},
            choices = ${values.choices}, correct_choices = ${values.correct_choices}, multiple_choice = ${values.multiple_choice},
            choice_explanations = ${values.choice_explanations}, verified_hash = ${values.verified_hash},
            verified_at = ${coding ? tx`now()` : null}, updated_by_principal_id = ${viewer.principalId}, updated_at = now()
          WHERE id = ${questionId} AND kind = ${values.kind} RETURNING id`;
        if (updated.length === 0) throw new Error("not_found");
        await tx`DELETE FROM question_tests WHERE question_id = ${questionId}`;
        await tx`DELETE FROM question_solutions WHERE question_id = ${questionId}`;
        await tx`DELETE FROM question_templates WHERE question_id = ${questionId}`;
      } else {
        const created = await tx`
          INSERT INTO questions (slug, category_id, kind, audience, tags, title, prompt_markdown, difficulty, supported_languages, time_limit_ms, memory_limit_kib,
            choices, correct_choices, multiple_choice, choice_explanations, verified_hash, verified_at, author_principal_id, author_name, updated_by_principal_id)
          VALUES (${values.slug}, ${values.category_id}, ${values.kind}, ${values.audience}, ${values.tags}, ${values.title}, ${values.prompt_markdown}, ${values.difficulty},
            ${values.supported_languages}, ${values.time_limit_ms}, ${values.memory_limit_kib}, ${values.choices}, ${values.correct_choices}, ${values.multiple_choice},
            ${values.choice_explanations}, ${values.verified_hash}, ${coding ? tx`now()` : null}, ${viewer.principalId}, ${viewer.name}, ${viewer.principalId})
          RETURNING id`;
        questionId = created[0]!.id as string;
      }
      for (const [position, test] of question.tests.entries()) {
        await tx`INSERT INTO question_tests (question_id, position, input, expected_output, is_sample, weight) VALUES (${questionId}, ${position}, ${test.input}, ${test.expected_output}, ${test.is_sample}, ${test.weight})`;
      }
      for (const solution of question.solutions) {
        await tx`INSERT INTO question_solutions (question_id, language, source) VALUES (${questionId}, ${solution.language}, ${solution.source})`;
      }
      for (const template of question.templates) {
        await tx`INSERT INTO question_templates (question_id, language, starter, prefix, suffix) VALUES (${questionId}, ${template.language}, ${template.starter}, ${template.prefix}, ${template.suffix})`;
      }
      if (hash) {
        await tx`UPDATE verifications SET question_id = ${questionId} WHERE id = (SELECT id FROM verifications WHERE content_hash = ${hash} AND run_by_principal_id = ${viewer.principalId} AND passed ORDER BY run_at DESC LIMIT 1)`;
      }
      return questionId as string;
    });
    revalidatePath("/");
    revalidatePath(`/topics/${question.topic_id}`);
    return { id: savedId, topicId: question.topic_id };
  } catch (error) {
    if (error instanceof Error && error.message === "not_found") return { error: "That question no longer exists." };
    throw error;
  }
}

export async function deleteQuestion(id: string) {
  const { viewer } = await requireViewer();
  const [row] = await sql`SELECT author_principal_id, category_id FROM questions WHERE id = ${id}`;
  const admin = viewer.roles.some((role) => role === "super_admin" || role === "college_admin");
  if (!row || (row.author_principal_id !== viewer.principalId && !admin)) return;
  await sql`DELETE FROM questions WHERE id = ${id}`;
  revalidatePath("/");
  redirect(`/topics/${row.category_id}`);
}
