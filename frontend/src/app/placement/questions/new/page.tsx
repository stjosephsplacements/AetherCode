import type { Metadata } from "next";
import { panel } from "@/app/admin/_dashboard/panel";
import { PageHeader } from "@/components/staff/page-header";
import { QuestionWizard } from "@/components/staff/question-wizard/question-wizard";
import { listCategories, listTagSuggestions } from "@/lib/server/categories";
import { listLanguages } from "@/lib/server/languages";
import { requirePlacement } from "@/lib/server/placement";
import { cn } from "@/lib/utils";
import { createDraft } from "../actions";

export const metadata: Metadata = { title: "New placement question" };

export default async function PlacementNewQuestionPage() {
  await requirePlacement();
  const [{ languages }, categories, tagSuggestions] = await Promise.all([listLanguages(), listCategories(), listTagSuggestions()]);
  return (
    <div className="animate-enter">
      <PageHeader
        title="New question"
        description="Shared question bank. Placement exams can draw from anything you publish here."
      />
      <section className={cn(panel, "mt-8")}>
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Authoring</p>
        <div className="mt-4 min-w-0">
          <QuestionWizard
            languages={languages}
            categories={categories}
            tagSuggestions={tagSuggestions}
            createDraft={createDraft}
            afterSaveHref={(versionId) => `/placement/questions/${versionId}`}
          />
        </div>
      </section>
    </div>
  );
}
