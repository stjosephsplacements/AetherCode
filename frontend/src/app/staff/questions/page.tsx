import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import type { Page, QuestionDetail } from "@/lib/api-types";
import { listCategories } from "@/lib/server/categories";
import { gateway } from "@/lib/server/gateway";
import { listLanguages } from "@/lib/server/languages";
import { requireStaff } from "@/lib/server/staff";
import { ImportDialog } from "./import-dialog";
import { ManageCategories } from "./manage-categories";
import { type ListKey, type Lists, QuestionBoard, type QuestionRow } from "./question-board";

export const metadata: Metadata = { title: "Questions" };

const LIMIT = 100;

async function fetchList(status: "" | "draft" | "review") {
  return gateway<Page<QuestionDetail>>(`/question-bank/v1/questions?limit=${LIMIT}${status ? `&status=${status}` : ""}`);
}

const toRow = (viewerId: string) => ({ question, question_version: version }: QuestionDetail): QuestionRow => ({
  versionId: version.id,
  title: version.title,
  slug: question.slug,
  kind: version.kind,
  difficulty: version.difficulty,
  languages: version.supported_languages,
  sample: version.sample_test_case_count,
  hidden: version.hidden_test_case_count,
  options: version.choices?.length ?? 0,
  categoryId: question.category?.id ?? question.category_id ?? "",
  categoryName: question.category?.name ?? "",
  tags: (version.tags ?? []).map((entry) => entry.name),
  versionNumber: version.version_number,
  prompt: version.prompt_markdown,
  timeMs: version.time_limit_ms,
  memoryMb: Math.round(version.memory_limit_kib / 1024),
  audience: question.audience === "practice" ? "practice" : "test",
  status: version.status === "published" ? "published" : "draft",
  inReview: Boolean(version.review_requested_at),
  forYou: version.assigned_reviewer_id === viewerId,
});

const TABS: ListKey[] = ["tests", "practice", "drafts", "review"];

export default async function QuestionsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const staff = await requireStaff();
  const requested = (await searchParams).tab;
  const initial = TABS.find((tab) => tab === requested) ?? "tests";
  let published: Page<QuestionDetail>;
  try {
    published = await fetchList("");
  } catch (error) {
    return (
      <>
        <PageHeader title="Questions" />
        <LoadError error={error} />
      </>
    );
  }
  // The other lists are separate requests; a role that cannot read one still gets the rest.
  const [drafts, review, { languages }, categories] = await Promise.all([fetchList("draft").catch(() => null), fetchList("review").catch(() => null), listLanguages(), listCategories()]);
  const row = toRow(staff.viewer.principalId);
  // Practice problems are published questions marked for practice (ADR-0041).
  const lists: Lists = {
    tests: published.items.filter(({ question }) => question.audience !== "practice").map(row),
    practice: published.items.filter(({ question }) => question.audience === "practice").map(row),
    drafts: (drafts?.items ?? []).map(row),
    review: (review?.items ?? []).map(row),
  };

  return (
    <>
      <PageHeader
        title="Questions"
        description="One question bank shared by every college. A coding question is published only after a model solution passes every one of its tests."
        actions={
          <>
            {staff.canManageAccounts && categories.length > 0 && <ManageCategories categories={categories} />}
            <ImportDialog />
            <Button asChild>
              <Link href="/staff/questions/new">
                <Plus />
                New question
              </Link>
            </Button>
          </>
        }
      />
      <QuestionBoard
        lists={lists}
        languages={languages}
        categories={categories}
        initial={initial}
        capped={{ tests: Boolean(published.next_cursor), practice: Boolean(published.next_cursor), drafts: Boolean(drafts?.next_cursor), review: Boolean(review?.next_cursor) }}
      />
    </>
  );
}
