import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuestionEditor } from "@/components/editor";
import { Shell } from "@/components/shell";
import { sql } from "@/lib/db";
import { listTopics } from "@/lib/data";
import { type Draft, blankDraft } from "@/lib/draft";
import type { LanguageId } from "@/lib/languages";
import { requireViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Edit question" };

export default async function EditQuestion({ params }: { params: Promise<{ id: string }> }) {
  const { viewer } = await requireViewer();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [question] = await sql`SELECT * FROM questions WHERE id = ${id}`;
  if (!question) notFound();
  const tests = await sql`SELECT input, expected_output, is_sample, weight FROM question_tests WHERE question_id = ${id} ORDER BY position`;
  const solutions = await sql`SELECT language, source FROM question_solutions WHERE question_id = ${id}`;
  const templates = await sql`SELECT language, starter, prefix, suffix FROM question_templates WHERE question_id = ${id}`;
  const topics = await listTopics();
  const choices = (question.choices as string[] | null) ?? [];
  const draft: Draft = {
    ...blankDraft(question.category_id as string, question.difficulty as Draft["difficulty"]),
    kind: question.kind as Draft["kind"],
    title: question.title as string,
    slug: question.slug as string,
    audience: question.audience as Draft["audience"],
    tags: question.tags as string[],
    prompt: question.prompt_markdown as string,
    languages: (question.supported_languages as LanguageId[]).length ? (question.supported_languages as LanguageId[]) : ["python3"],
    timeSeconds: (question.time_limit_ms as number) / 1000,
    memoryMb: Math.round((question.memory_limit_kib as number) / 1024),
    tests: tests.length ? tests.map((test) => ({ input: test.input as string, expected_output: test.expected_output as string, is_sample: test.is_sample as boolean, weight: test.weight as number })) : blankDraft().tests,
    solutions: Object.fromEntries(solutions.map((solution) => [solution.language as string, solution.source as string])) as Draft["solutions"],
    templates: Object.fromEntries(templates.map((template) => [template.language as string, { starter: template.starter as string, prefix: template.prefix as string, suffix: template.suffix as string }])) as Draft["templates"],
    choices: choices.length ? choices : ["", ""],
    correct: (question.correct_choices as number[] | null) ?? [],
    multiple: question.multiple_choice as boolean,
    explanations: choices.length ? choices.map((_, index) => ((question.choice_explanations as (string | null)[] | null)?.[index] ?? "")) : ["", ""],
  };
  const canDelete = question.author_principal_id === viewer.principalId || viewer.roles.some((role) => role === "super_admin" || role === "college_admin");
  return (
    <Shell viewer={viewer}>
      <h1 className="mb-1 text-[26px] font-semibold tracking-tight">{draft.title}</h1>
      <p className="mb-5 text-[13px] text-ink-muted">Uploaded by {question.author_name as string}. {draft.kind === "coding" ? "Saving changes needs a fresh judge verification." : "Multiple choice: nothing to run."}</p>
      <QuestionEditor id={id} initial={draft} topics={topics.map(({ id: topicId, name, parent_id }) => ({ id: topicId, name, parent_id }))} canDelete={canDelete} />
    </Shell>
  );
}
