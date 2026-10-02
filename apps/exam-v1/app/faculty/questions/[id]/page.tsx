import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { Card, PageHeader, buttonClass } from "@/components/ui";
import { QuestionForm } from "../question-form";
import { regradeQuestion } from "../../actions";

export default async function EditQuestionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await requireUser("faculty", "admin");
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [question] = await sql<
    {
      title: string;
      statement: string;
      time_limit_ms: number;
      memory_limit_kb: number;
      reference_language: string | null;
      reference_source: string | null;
      kind: "coding" | "mcq";
      mcq_options: string[] | null;
      mcq_correct: number[] | null;
    }[]
  >`SELECT title, statement, time_limit_ms, memory_limit_kb, reference_language, reference_source, kind, mcq_options, mcq_correct
    FROM questions WHERE id = ${id}`;
  if (!question) notFound();
  const tests = await sql<{ input: string; expected_output: string; is_sample: boolean; weight: number }[]>`
    SELECT input, expected_output, is_sample, weight FROM test_cases WHERE question_id = ${id} ORDER BY ord`;
  const [{ count }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM submissions WHERE question_id = ${id} AND kind = 'submit'`;

  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="Question bank"
        title={question.title}
        actions={
          <a href={`/faculty/questions/export?id=${id}`} className={buttonClass("secondary")}>
            Export
          </a>
        }
      />
      {saved && <p className="mb-6 rounded-xl bg-pass-soft px-4 py-3 text-sm font-medium text-pass">Saved.</p>}
      {count > 0 && (
        <Card className="mb-6 flex flex-wrap items-center gap-3 border-accent/30 bg-accent-soft/50 p-5">
          <p className="mr-auto text-sm">
            <strong>{count}</strong> graded submission{count === 1 ? "" : "s"} use this question. Changing test cases does not rescore them
            until you regrade.
          </p>
          <form action={regradeQuestion.bind(null, id)}>
            <button className={buttonClass("secondary", "sm")}>Regrade all submissions</button>
          </form>
        </Card>
      )}
      <QuestionForm
        id={id}
        initial={{
          title: question.title,
          statement: question.statement,
          timeLimitMs: question.time_limit_ms,
          memoryLimitMb: Math.round(question.memory_limit_kb / 1024),
          tests: tests.map((test) => ({ input: test.input, expectedOutput: test.expected_output, isSample: test.is_sample, weight: test.weight })),
          kind: question.kind,
          options: question.mcq_options ?? undefined,
          correct: question.mcq_correct ?? undefined,
          referenceLanguage: question.reference_language,
          referenceSource: question.reference_source,
        }}
      />
    </AppShell>
  );
}
