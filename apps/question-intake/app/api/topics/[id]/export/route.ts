import { NextResponse } from "next/server";
import { authorizeStaff } from "@/lib/authorize.ts";
import { sql } from "@/lib/db";

const FORMAT = "aethercode.intake.topic.v1";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeStaff(request);
  if (auth instanceof NextResponse) return auth;
  const { id: categoryId } = await params;
  const [topic] = await sql`
    SELECT c.id, c.name, p.name AS parent_name
    FROM categories c
    LEFT JOIN categories p ON p.id = c.parent_id
    WHERE c.id = ${categoryId}`;
  if (!topic) return NextResponse.json({ code: "not_found", message: "Topic not found." }, { status: 404 });

  const questions = await sql`SELECT * FROM questions WHERE category_id = ${categoryId} ORDER BY created_at`;
  const tests = await sql`SELECT question_id, position, input, expected_output, is_sample, weight FROM question_tests WHERE question_id IN (SELECT id FROM questions WHERE category_id = ${categoryId}) ORDER BY question_id, position`;
  const solutions = await sql`SELECT question_id, language, source FROM question_solutions WHERE question_id IN (SELECT id FROM questions WHERE category_id = ${categoryId})`;
  const templates = await sql`SELECT question_id, language, starter, prefix, suffix FROM question_templates WHERE question_id IN (SELECT id FROM questions WHERE category_id = ${categoryId})`;
  const links = await sql`SELECT intake_question_id, bank_question_id, bank_version_id FROM question_bank_links WHERE intake_question_id IN (SELECT id FROM questions WHERE category_id = ${categoryId})`;
  const linked = new Map(links.map((row) => [row.intake_question_id as string, row]));
  const by = (rows: readonly Record<string, unknown>[], questionId: unknown) => rows.filter((row) => row.question_id === questionId);

  return NextResponse.json({
    format: FORMAT,
    exported_at: new Date().toISOString(),
    topic: { id: topic.id, name: topic.name, parent_name: topic.parent_name ?? null },
    questions: questions.map((question) => {
      const bank = linked.get(question.id as string);
      return {
        intake_question_id: question.id,
        slug: question.slug,
        kind: question.kind,
        audience: question.audience,
        tags: question.tags,
        title: question.title,
        prompt_markdown: question.prompt_markdown,
        difficulty: question.difficulty,
        supported_languages: question.supported_languages,
        time_limit_ms: question.time_limit_ms,
        memory_limit_kib: question.memory_limit_kib,
        choices: question.choices,
        correct_choices: question.correct_choices,
        multiple_choice: question.multiple_choice,
        choice_explanations: question.choice_explanations,
        tests: by(tests, question.id).map(({ position, input, expected_output, is_sample, weight }) => ({
          position,
          input,
          expected_output,
          sample: is_sample,
          weight,
        })),
        model_solutions: by(solutions, question.id).map(({ language, source }) => ({ language, source })),
        templates: by(templates, question.id).map(({ language, starter, prefix, suffix }) => ({ language, starter, prefix, suffix })),
        bank_link: bank ? { question_id: bank.bank_question_id, version_id: bank.bank_version_id } : null,
      };
    }),
  });
}