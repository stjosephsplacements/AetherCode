import type { Metadata } from "next";
import { PageHeader } from "@/components/staff/page-header";
import { QuestionWizard } from "@/components/staff/question-wizard/question-wizard";
import { listCategories, listTagSuggestions } from "@/lib/server/categories";
import { listLanguages } from "@/lib/server/languages";
import { requireStaff } from "@/lib/server/staff";

export const metadata: Metadata = { title: "New question" };

export default async function NewQuestionPage() {
  await requireStaff();
  const [{ languages }, categories, tagSuggestions] = await Promise.all([listLanguages(), listCategories(), listTagSuggestions()]);
  return (
    <>
      <PageHeader title="New question" description="Write the statement, add the tests, then save. A coding question is checked with a model solution before it can be published." />
      <QuestionWizard languages={languages} categories={categories} tagSuggestions={tagSuggestions} />
    </>
  );
}
