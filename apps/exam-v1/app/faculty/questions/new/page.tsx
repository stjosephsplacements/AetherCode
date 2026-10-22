import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/ui";
import { QuestionForm } from "../question-form";

export default async function NewQuestionPage() {
  const user = await requireUser("faculty", "admin");
  const topicRows = await sql<{ topic: string }[]>`
    SELECT DISTINCT topic FROM questions WHERE topic IS NOT NULL ORDER BY topic`;
  return (
    <AppShell user={user}>
      <PageHeader eyebrow="Question bank" title="New question" />
      <QuestionForm id={null} topics={topicRows.map((r) => r.topic)} />
    </AppShell>
  );
}
