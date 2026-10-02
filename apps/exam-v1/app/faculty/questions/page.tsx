import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, PageHeader, buttonClass } from "@/components/ui";
import { ImportQuestions } from "./import-questions";

export default async function QuestionsPage() {
  const user = await requireUser("faculty", "admin");
  const questions = await sql<
    { id: string; title: string; kind: string; options: number | null; samples: number; hidden: number; updated_at: Date; author: string | null }[]
  >`
    SELECT q.id, q.title, q.kind, array_length(q.mcq_options, 1) AS options, q.updated_at, u.name AS author,
      count(t.*) FILTER (WHERE t.is_sample)::int AS samples,
      count(t.*) FILTER (WHERE NOT t.is_sample)::int AS hidden
    FROM questions q
    LEFT JOIN test_cases t ON t.question_id = q.id
    LEFT JOIN users u ON u.id = q.created_by
    GROUP BY q.id, u.name ORDER BY q.updated_at DESC`;
  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="Question bank"
        title="Questions"
        actions={
          <>
            <ImportQuestions />
            {questions.length > 0 && (
              <a href="/faculty/questions/export" className={buttonClass("secondary")}>
                Export all
              </a>
            )}
            <Link href="/faculty/questions/new" className={buttonClass()}>
              New question
            </Link>
          </>
        }
      />
      <Card className="divide-y divide-line">
        {questions.map((question) => (
          <Link key={question.id} href={`/faculty/questions/${question.id}`} className="flex flex-wrap items-center gap-3 px-5 py-4 hover:bg-sunken/60">
            <span className="mr-auto font-semibold">{question.title}</span>
            {question.kind === "mcq" ? (
              <Badge tone="accent">Multiple choice · {question.options} options</Badge>
            ) : (
              <>
                <Badge tone="brand">{question.samples} sample</Badge>
                <Badge>{question.hidden} hidden</Badge>
              </>
            )}
            <span className="w-40 text-right text-xs text-faint">
              {question.author ?? "—"} · {question.updated_at.toLocaleDateString("en-IN")}
            </span>
          </Link>
        ))}
        {questions.length === 0 && <p className="px-5 py-12 text-center text-sm text-muted">No questions yet. Create your first one.</p>}
      </Card>
    </AppShell>
  );
}
