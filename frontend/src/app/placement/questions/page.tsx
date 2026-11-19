import { Plus } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, LoadError, PageHeader, Table } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import type { AccountSummary, QuestionDetail } from "@/lib/api-types";
import { authorName } from "@/lib/author-name";
import { fetchAllPages } from "@/lib/server/fetch-all";
import { requirePlacement } from "@/lib/server/placement";
import { describeAccounts } from "@/lib/server/people";
import { languageName } from "@/lib/utils";

export const metadata: Metadata = { title: "Questions" };

export default async function PlacementQuestionsPage() {
  const placement = await requirePlacement();
  let questions;
  try {
    questions = await fetchAllPages<QuestionDetail>("/question-bank/v1/questions");
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Questions" />
        <LoadError error={error} />
      </div>
    );
  }

  const collegeId = placement.colleges[0]?.id ?? placement.viewer.tenantId;
  const authorIds = questions.map(({ question_version }) => question_version.created_by).filter((id): id is string => Boolean(id));
  const names = collegeId && authorIds.length
    ? await describeAccounts(collegeId, authorIds).catch(() => new Map<string, AccountSummary>())
    : new Map<string, AccountSummary>();

  const tests = questions.filter(({ question }) => question.audience !== "practice");
  const practice = questions.filter(({ question }) => question.audience === "practice");

  const rows = (list: QuestionDetail[]) =>
    list.map(({ question_version: version }) => (
      <tr key={version.id}>
        <td className="px-4 py-2.5 font-medium text-ink">
          <Link href={`/placement/questions/${version.id}`} className="hover:text-brand">
            {version.title}
          </Link>
        </td>
        <td className="px-4 py-2.5">
          <Badge tone="neutral">{version.difficulty}</Badge>
        </td>
        <td className="px-4 py-2.5 text-[13px] text-ink-muted">{version.supported_languages.map(languageName).join(", ")}</td>
        <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-ink-muted">
          {version.sample_test_case_count + version.hidden_test_case_count}
        </td>
        <td className="px-4 py-2.5 text-[13px] text-ink-muted">{authorName(names, version.created_by)}</td>
        <td className="px-4 py-2.5">
          <Badge tone={version.status === "published" ? "success" : "neutral"}>{version.status}</Badge>
        </td>
      </tr>
    ));

  return (
    <div className="animate-enter space-y-6">
      <PageHeader
        title="Questions"
        description="Shared bank for placement exams. Author drafts here; publish after a model check."
        actions={
          <Button asChild size="sm">
            <Link href="/placement/questions/new">
              <Plus />
              New question
            </Link>
          </Button>
        }
      />

      <section>
        <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.01em] text-ink">Test questions ({tests.length})</h2>
        {tests.length === 0 ? (
          <EmptyState>No test questions yet.</EmptyState>
        ) : (
          <Table head={["Title", "Difficulty", "Languages", "Tests", "Author", "Status"]}>{rows(tests)}</Table>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.01em] text-ink">Practice questions ({practice.length})</h2>
        {practice.length === 0 ? (
          <EmptyState>No practice questions yet.</EmptyState>
        ) : (
          <Table head={["Title", "Difficulty", "Languages", "Tests", "Author", "Status"]}>{rows(practice)}</Table>
        )}
      </section>
    </div>
  );
}
