import { Plus } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import type { QuestionDetail } from "@/lib/api-types";
import { listCategories } from "@/lib/server/categories";
import { fetchAllPages } from "@/lib/server/fetch-all";
import { listLanguages } from "@/lib/server/languages";
import { requireStaff } from "@/lib/server/staff";
import { ImportDialog } from "./import-dialog";
import { ManageCategories } from "./manage-categories";
import { type ListKey, type Lists, QuestionBoard, type QuestionRow } from "./question-board";

export const metadata: Metadata = { title: "Questions" };

function fetchList(status: "" | "draft" | "review") {
  return fetchAllPages<QuestionDetail>(`/question-bank/v1/questions${status ? `?status=${status}` : ""}`);
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
  let published: QuestionDetail[];
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
    tests: published.filter(({ question }) => question.audience !== "practice").map(row),
    practice: published.filter(({ question }) => question.audience === "practice").map(row),
    drafts: (drafts ?? []).map(row),
    review: (review ?? []).map(row),
  };

  return (
    <>
      <PageHeader
        title="Questions"
        description="Questions shared across colleges. A question must pass all tests with a model solution before you can publish it."
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
      />
    </>
  );
}
