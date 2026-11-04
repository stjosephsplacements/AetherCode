import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireViewer } from "@/lib/session";

/**
 * Every saved question in the platform's own shape (topic path, slug, fields of a question version, tests, model solutions,
 * templates), for the import into the question bank. Staff only.
 */
export async function GET() {
  await requireViewer();
  const categories = await sql`SELECT c.id, c.name, p.name AS parent FROM categories c LEFT JOIN categories p ON p.id = c.parent_id`;
  const questions = await sql`SELECT * FROM questions ORDER BY created_at`;
  const tests = await sql`SELECT question_id, position, input, expected_output, is_sample, weight FROM question_tests ORDER BY question_id, position`;
  const solutions = await sql`SELECT question_id, language, source FROM question_solutions`;
  const templates = await sql`SELECT question_id, language, starter, prefix, suffix FROM question_templates`;
  const name = new Map(categories.map((row) => [row.id as string, row]));
  const by = (rows: readonly Record<string, unknown>[], id: unknown) => rows.filter((row) => row.question_id === id);
  return NextResponse.json({
    exported_at: new Date().toISOString(),
    questions: questions.map((question) => {
      const topic = name.get(question.category_id as string);
      return {
        slug: question.slug,
        topic: topic?.name,
        parent_topic: topic?.parent ?? null,
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
        tests: by(tests, question.id).map(({ position, input, expected_output, is_sample, weight }) => ({ position, input, expected_output, sample: is_sample, weight })),
        model_solutions: by(solutions, question.id).map(({ language, source }) => ({ language, source })),
        templates: by(templates, question.id).map(({ language, starter, prefix, suffix }) => ({ language, starter, prefix, suffix })),
        author: question.author_name,
      };
    }),
  });
}
