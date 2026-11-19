import { Plus } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { FigureCard } from "@/app/admin/_dashboard/charts";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import type { AccountSummary, QuestionDetail } from "@/lib/api-types";
import { authorName } from "@/lib/author-name";
import { listCategories } from "@/lib/server/categories";
import { fetchAllPages } from "@/lib/server/fetch-all";
import { listLanguages } from "@/lib/server/languages";
import { describeAccounts } from "@/lib/server/people";
import { requireStaff } from "@/lib/server/staff";
import { ImportDialog } from "./import-dialog";
import { loadIntakeTopics } from "./actions";
import { ManageCategories } from "./manage-categories";
import { type ListKey, type Lists, QuestionBoard, type QuestionRow } from "./question-board";

export const metadata: Metadata = { title: "Questions" };

async function fetchList(status: "" | "draft" | "review") {
  return fetchAllPages<QuestionDetail>(`/question-bank/v1/questions${status ? `?status=${status}` : ""}`);
}

const toRow = (viewerId: string, names: Map<string, AccountSummary>) => ({ question, question_version: version }: QuestionDetail): QuestionRow => ({
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
  authorName: authorName(names, version.created_by),
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
      <div className="animate-enter">
        <PageHeader title="Questions" />
        <LoadError error={error} />
      </div>
    );
  }
  // The other lists are separate requests; a role that cannot read one still gets the rest.
  const [drafts, review, { languages }, categories, intakeTopics] = await Promise.all([
    fetchList("draft").catch(() => null),
    fetchList("review").catch(() => null),
    listLanguages(),
    listCategories(),
    loadIntakeTopics().catch(() => []),
  ]);
  const authorIds = [...published, ...(drafts ?? []), ...(review ?? [])]
    .map(({ question_version }) => question_version.created_by)
    .filter((id): id is string => Boolean(id));
  const names = staff.tenantId && authorIds.length
    ? await describeAccounts(staff.tenantId, authorIds).catch(() => new Map<string, AccountSummary>())
    : new Map<string, AccountSummary>();
  const row = toRow(staff.viewer.principalId, names);
  // Practice problems are published questions marked for practice (ADR-0041).
  const lists: Lists = {
    tests: published.items.filter(({ question }) => question.audience !== "practice").map(row),
    practice: published.items.filter(({ question }) => question.audience === "practice").map(row),
    drafts: (drafts?.items ?? []).map(row),
    review: (review?.items ?? []).map(row),
  };
  const total = lists.tests.length + lists.practice.length + lists.drafts.length + lists.review.length;

  return (
    <div className="animate-enter">
      <PageHeader
        title="Questions"
        description="Questions shared across colleges. A question must pass all tests with a model solution before you can publish it."
        actions={
          <>
            {staff.canManageAccounts && categories.length > 0 && <ManageCategories categories={categories} />}
            <ImportDialog intakeTopics={intakeTopics} />
            <Button asChild>
              <Link href="/staff/questions/new">
                <Plus />
                New question
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FigureCard label="In bank" value={String(total)} note="loaded on this page" />
        <FigureCard label="Tests" value={`${lists.tests.length}${published.next_cursor ? "+" : ""}`} note="published for exams" />
        <FigureCard label="Drafts" value={`${lists.drafts.length}${drafts?.next_cursor ? "+" : ""}`} note="not published yet" />
        <FigureCard
          label="To review"
          value={`${lists.review.length}${review?.next_cursor ? "+" : ""}`}
          note={lists.review.length ? "waiting on staff" : "all caught up"}
          tone={lists.review.length ? "warn" : "good"}
        />
      </div>

      <QuestionBoard
        lists={lists}
        languages={languages}
        categories={categories}
        initial={initial}
        capped={{ tests: Boolean(published.next_cursor), practice: Boolean(published.next_cursor), drafts: Boolean(drafts?.next_cursor), review: Boolean(review?.next_cursor) }}
      />
    </div>
  );
}
