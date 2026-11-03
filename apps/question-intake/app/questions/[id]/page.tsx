import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuestionEditor } from "@/components/editor";
import type { Draft } from "@/lib/draft";
import { Shell } from "@/components/shell";
import { sql } from "@/lib/db";
import type { LanguageId } from "@/lib/languages";
import { requireViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Edit question" };

export default async function EditQuestion({ params }: { params: Promise<{ id: string }> }) {
  const { viewer } = await requireViewer();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [question] = await sql`SELECT * FROM questions WHERE id = ${id}`;
  if (!question) notFound();
  const tests = await sql`SELECT input, expected_output, is_sample FROM question_tests WHERE question_id = ${id} ORDER BY position`;
  const solutions = await sql`SELECT language, source FROM question_solutions WHERE question_id = ${id}`;
  const draft: Draft = {
    title: question.title as string,
    difficulty: question.difficulty as Draft["difficulty"],
    topics: (question.topics as string[]).join(", "),
    statement_md: question.statement_md as string,
    input_format: question.input_format as string,
    output_format: question.output_format as string,
    constraints_md: question.constraints_md as string,
    time_limit_ms: question.time_limit_ms as number,
    memory_limit_kb: question.memory_limit_kb as number,
    tests: tests.map((test) => ({ input: test.input as string, expected_output: test.expected_output as string, is_sample: test.is_sample as boolean })),
    solutions: Object.fromEntries(solutions.map((solution) => [solution.language as LanguageId, solution.source as string])),
  };
  const canDelete = question.author_principal_id === viewer.principalId || viewer.roles.some((role) => role === "super_admin" || role === "college_admin");
  return (
    <Shell viewer={viewer}>
      <h1 className="mb-1 text-[26px] font-semibold tracking-tight">{draft.title}</h1>
      <p className="mb-5 text-[13px] text-ink-muted">Uploaded by {question.author_name as string}. Saving changes needs a fresh judge verification.</p>
      <QuestionEditor id={id} initial={draft} canDelete={canDelete} />
    </Shell>
  );
}
