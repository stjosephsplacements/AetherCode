import type { Metadata } from "next";
import { LoadError, PageHeader, Table } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import type { Page, QuestionDetail } from "@/lib/api-types";
import { gateway } from "@/lib/server/gateway";
import { requirePlacement } from "@/lib/server/placement";
import { languageName } from "@/lib/utils";

export const metadata: Metadata = { title: "Questions" };

export default async function PlacementQuestionsPage() {
  await requirePlacement();
  let questions;
  try {
    questions = (await gateway<Page<QuestionDetail>>("/question-bank/v1/questions?limit=200")).items;
  } catch (error) {
    return (
      <>
        <PageHeader title="Questions" />
        <LoadError error={error} />
      </>
    );
  }

  const tests = questions.filter(({ question }) => question.audience !== "practice");
  const practice = questions.filter(({ question }) => question.audience === "practice");

  return (
    <>
      <PageHeader
        title="Questions"
        description="Questions shared by all colleges. Browse what's available for placement exams."
      />
      <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.01em] text-ink">Test questions ({tests.length})</h2>
      {tests.length > 0 && (
        <Table head={["Title", "Difficulty", "Languages", "Tests", "Status"]}>
          {tests.map(({ question_version: version }) => (
            <tr key={version.id}>
              <td className="px-4 py-2.5 font-medium text-ink">{version.title}</td>
              <td className="px-4 py-2.5"><Badge tone="neutral">{version.difficulty}</Badge></td>
              <td className="px-4 py-2.5 text-[13px] text-ink-muted">{version.supported_languages.map(languageName).join(", ")}</td>
              <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-ink-muted">{version.sample_test_case_count + version.hidden_test_case_count}</td>
              <td className="px-4 py-2.5"><Badge tone={version.status === "published" ? "success" : "neutral"}>{version.status}</Badge></td>
            </tr>
          ))}
        </Table>
      )}

      <h2 className="mb-3 mt-8 text-[15px] font-semibold tracking-[-0.01em] text-ink">Practice questions ({practice.length})</h2>
      {practice.length > 0 && (
        <Table head={["Title", "Difficulty", "Languages", "Tests"]}>
          {practice.map(({ question_version: version }) => (
            <tr key={version.id}>
              <td className="px-4 py-2.5 font-medium text-ink">{version.title}</td>
              <td className="px-4 py-2.5"><Badge tone="neutral">{version.difficulty}</Badge></td>
              <td className="px-4 py-2.5 text-[13px] text-ink-muted">{version.supported_languages.map(languageName).join(", ")}</td>
              <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-ink-muted">{version.sample_test_case_count + version.hidden_test_case_count}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
