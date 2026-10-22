import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, LoadError, PageHeader, Section } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import type { Page, QuestionDetail } from "@/lib/api-types";
import { gateway } from "@/lib/server/gateway";
import { requireStaff } from "@/lib/server/staff";
import { cn, languageName } from "@/lib/utils";
import { ImportQuestionForm } from "./import-form";

export const metadata: Metadata = { title: "Questions" };

const DIFFICULTY_TONE = { easy: "success", medium: "warning", hard: "danger" } as const;

export default async function QuestionsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const staff = await requireStaff();
  const tab = (await searchParams).tab;
  const drafts = tab === "drafts";
  const review = tab === "review";
  const practice = tab === "practice";
  let questions: QuestionDetail[];
  try {
    questions = (await gateway<Page<QuestionDetail>>(`/question-bank/v1/questions?limit=100${drafts ? "&status=draft" : review ? "&status=review" : ""}`)).items;
    // Practice problems are published questions marked for practice (ADR-0041).
    if (!drafts && !review) questions = questions.filter(({ question }) => (question.audience === "practice") === practice);
  } catch (error) {
    return (
      <>
        <PageHeader title="Questions" />
        <LoadError error={error} />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Questions"
        description="One question bank shared by every college. Published questions can be added to any exam."
        actions={
          <Button asChild>
            <Link href="/staff/questions/new">
              <Plus />
              New question
            </Link>
          </Button>
        }
      />
      <nav aria-label="Question lists" className="mb-4 flex gap-1.5">
        {[
          { href: "/staff/questions", label: "Tests", active: !drafts && !practice && !review },
          { href: "/staff/questions?tab=practice", label: "Practice", active: practice },
          { href: "/staff/questions?tab=drafts", label: "My drafts", active: drafts },
          { href: "/staff/questions?tab=review", label: "To review", active: review },
        ].map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={tab.active ? "page" : undefined}
            className={cn("rounded-full px-3 py-1 text-[13px]", tab.active ? "bg-ink text-canvas" : "bg-hover text-ink-muted hover:text-ink")}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {questions.length === 0 ? (
        <EmptyState>
          {drafts
            ? "You have no drafts."
            : review
              ? "Nothing is waiting for a review."
              : practice
              ? "No practice problems yet. Open a published question and switch it to Practice."
              : "No published test questions yet. Write one and publish it."}
        </EmptyState>
      ) : (
        <ul className="overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
          {questions.map(({ question, question_version: version }, index) => (
            <li key={version.id} className={cn(index > 0 && "border-t border-line")}>
              <Link href={`/staff/questions/${version.id}`} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-hover">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-ink">{version.title}</p>
                  <p className="mt-0.5 truncate text-[13px] text-ink-muted">
                    {version.kind === "mcq"
                      ? `${question.slug}, multiple choice, ${version.choices?.length ?? 0} options`
                      : `${question.slug}, ${version.supported_languages.map(languageName).join(", ")}, ${version.sample_test_case_count} sample and ${version.hidden_test_case_count} hidden tests`}
                  </p>
                </div>
                <Badge tone={DIFFICULTY_TONE[version.difficulty]}>{version.difficulty}</Badge>
                {review && version.assigned_reviewer_id === staff.viewer.principalId && <Badge tone="brand">For you</Badge>}
                {version.status === "draft" && <Badge>{version.review_requested_at ? "In review" : "Draft"} v{version.version_number}</Badge>}
                {(drafts || review) && question.audience === "practice" && <Badge tone="brand">Practice</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Section title="Import" description="Add questions from a file a college administrator exported, or from the old exam app's question export. They arrive as your drafts, tests included.">
        <ImportQuestionForm />
      </Section>
    </>
  );
}
