import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/ui";
import { QuestionForm } from "../question-form";

export default async function NewQuestionPage() {
  const user = await requireUser("faculty", "admin");
  return (
    <AppShell user={user}>
      <PageHeader eyebrow="Question bank" title="New question" />
      <QuestionForm id={null} />
    </AppShell>
  );
}
