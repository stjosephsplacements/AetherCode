import type { Metadata } from "next";
import { panel } from "@/app/admin/_dashboard/panel";
import { PageHeader } from "@/components/staff/page-header";
import { cn } from "@/lib/utils";
import { QuestionWizard } from "@/components/staff/question-wizard/question-wizard";
import { listCategories, listTagSuggestions } from "@/lib/server/categories";
import { listLanguages } from "@/lib/server/languages";
import { requireStaff } from "@/lib/server/staff";

export const metadata: Metadata = { title: "New question" };

export default async function NewQuestionPage() {
  await requireStaff();
  const [{ languages }, categories, tagSuggestions] = await Promise.all([listLanguages(), listCategories(), listTagSuggestions()]);
  return (
    <div className="animate-enter">
      <PageHeader title="New question" description="Write the statement, add the tests, then save. A coding question is checked with a model solution before it can be published." />
      <section className={cn(panel, "mt-8")}>
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Authoring</p>
        <div className="mt-4 min-w-0">
          <QuestionWizard languages={languages} categories={categories} tagSuggestions={tagSuggestions} />
        </div>
      </section>
    </div>
  );
}
