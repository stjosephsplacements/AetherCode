import { ArrowLeft, Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Field, Select } from "@/components/staff/form";
import { LoadError, PageHeader, Section } from "@/components/staff/page-header";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Badge, Panel } from "@/components/ui/card";
import type { ModelCheck, QuestionVersion } from "@/lib/api-types";
import { gateway } from "@/lib/server/gateway";
import { reviewerChoices } from "@/lib/server/reviewers";
import { requireStaff } from "@/lib/server/staff";
import { languageName } from "@/lib/utils";
import { draftNewVersion, publishQuestion, requestReview } from "../actions";
import { AudienceSwitch } from "./audience-switch";
import { ModelCheckPanel } from "./model-check";
import { ChoicesEditor } from "./choices-editor";
import { TestsEditor } from "./tests-editor";

export const metadata: Metadata = { title: "Question" };

export default async function QuestionPage({ params }: { params: Promise<{ versionId: string }> }) {
  const staff = await requireStaff();
  const { versionId } = await params;
  let version: QuestionVersion;
  let checks: ModelCheck[];
  let requireReview: boolean;
  try {
    [version, checks, requireReview] = await Promise.all([
      gateway<QuestionVersion>(`/question-bank/v1/question-versions/${versionId}`),
      gateway<ModelCheck[]>(`/question-bank/v1/question-versions/${versionId}/model-checks`).catch(() => []),
      gateway<{ require_review: boolean }>("/question-bank/v1/review-policy").then((policy) => policy.require_review, () => false),
    ]);
  } catch (error) {
    return (
      <>
        <PageHeader title="Question" />
        <LoadError error={error} />
      </>
    );
  }
  const draft = version.status === "draft";
  // A multiple-choice draft has no languages until its options are saved (ADR-0035).
  const choice = version.kind === "mcq" || version.supported_languages.length === 0;
  const ready = choice ? version.kind === "mcq" : version.sample_test_case_count > 0 && version.hidden_test_case_count > 0;
  // A coding question is published only after a model solution passed every test (ADR-0047).
  const verified = checks.some((check) => check.lifecycle_state === "completed" && check.verdict === "accepted" && check.current);
  const canPublish = ready && (choice || verified);
  const reviewers = canPublish && requireReview && !version.review_requested_at ? await reviewerChoices(staff.tenantId, staff.viewer.principalId) : [];
  return (
    <>
      <Link href="/staff/questions" className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        Questions
      </Link>
      <PageHeader
        title={version.title}
        description={`Version ${version.version_number}, ${version.difficulty}, ${version.time_limit_ms / 1000} s, ${Math.round(version.memory_limit_kib / 1024)} MB, ${version.supported_languages.map(languageName).join(", ")}`}
        actions={
          <>
            {version.kind !== "mcq" && (
              <AudienceSwitch questionId={version.question_id} versionId={version.id} initial={version.audience ?? "test"} />
            )}
            <Badge tone={draft ? "neutral" : "success"}>{draft ? (version.review_requested_at ? "In review" : "Draft") : "Published"}</Badge>
            {/* Exports carry the hidden tests: administrators only, and each is logged (ADR-0032). */}
            {staff.canManageAccounts && version.kind !== "mcq" && version.hidden_test_case_count > 0 && (
              <Button asChild variant="secondary" size="sm">
                <a href={`/api/question-bank/v1/question-versions/${version.id}/export`} download={`${version.title.replace(/[^A-Za-z0-9]+/g, "-")}.json`}>
                  <Download />
                  Export
                </a>
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Panel className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Statement</h2>
          <Markdown>{version.prompt_markdown}</Markdown>
        </Panel>
        <div>
          {draft ? (
            <>
              {choice ? (
                <>
                  <h2 className="mb-3 text-sm font-semibold text-ink">Options</h2>
                  <ChoicesEditor
                    versionId={version.id}
                    expectedVersion={version.version}
                    initial={{ choices: version.choices ?? [], correct: version.correct_choices ?? [], multiple: version.multiple_choice }}
                  />
                </>
              ) : (
              <>
              <h2 className="mb-3 text-sm font-semibold text-ink">
                Tests{" "}
                <span className="font-normal text-ink-muted">
                  ({version.sample_test_case_count} sample, {version.hidden_test_case_count} hidden saved)
                </span>
              </h2>
              <TestsEditor versionId={version.id} expectedVersion={version.version} existing={version.sample_test_case_count + version.hidden_test_case_count} />
              </>
              )}
              <Section
                title="Publish"
                description={
                  canPublish
                    ? "Published questions cannot be edited; you can start a new draft version later."
                    : ready
                      ? "Run a model solution on every test in the check below. It must pass all of them, hidden tests included, before this question can be published. Changing the tests asks for a new check."
                    : choice
                      ? "Save the options and the correct answer first."
                      : "Save at least one sample and one hidden test first."
                }
              >
                {canPublish && !requireReview && (
                  <ActionForm action={publishQuestion} submitLabel="Publish question">
                    <input type="hidden" name="version_id" value={version.id} />
                    <input type="hidden" name="expected_version" value={version.version} />
                  </ActionForm>
                )}
                {canPublish && requireReview && !version.review_requested_at && (
                  <>
                    <p className="mb-3 text-sm text-ink-muted">A different member of staff has to approve this question before it is published.</p>
                    <ActionForm action={requestReview} submitLabel="Ask for a review">
                      <input type="hidden" name="version_id" value={version.id} />
                      <input type="hidden" name="expected_version" value={version.version} />
                      {reviewers.length > 0 && (
                        <Field label="Reviewer (optional)" hint="Anyone else on staff can still approve" htmlFor="reviewer">
                          <Select id="reviewer" name="reviewer_id" defaultValue="">
                            <option value="">Any reviewer</option>
                            {reviewers.map((reviewer) => (
                              <option key={reviewer.id} value={reviewer.id}>
                                {reviewer.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      )}
                    </ActionForm>
                  </>
                )}
                {canPublish && requireReview && version.review_requested_at && version.review_requested_by === staff.viewer.principalId && (
                  <p className="text-sm text-ink-muted">Waiting for another member of staff to review it. If you change it, ask again.</p>
                )}
                {canPublish && requireReview && version.review_requested_at && version.review_requested_by !== staff.viewer.principalId && (
                  <>
                    <p className="mb-3 text-sm text-ink-muted">
                      {version.assigned_reviewer_id === staff.viewer.principalId ? "This was sent to you. " : ""}Read the statement and tests, then approve. Approving publishes this version.
                    </p>
                    <ActionForm action={publishQuestion} submitLabel="Approve and publish">
                      <input type="hidden" name="version_id" value={version.id} />
                      <input type="hidden" name="expected_version" value={version.version} />
                    </ActionForm>
                  </>
                )}
              </Section>
            </>
          ) : (
            <Panel className="p-5">
              {version.kind === "mcq" && (
                <ol className="mb-4 space-y-1.5 text-sm">
                  {(version.choices ?? []).map((option, index) => (
                    <li key={index} className={version.correct_choices?.includes(index) ? "font-medium text-success" : "text-ink"}>
                      {String.fromCharCode(65 + index)}. {option}
                      {version.correct_choices?.includes(index) && " (correct)"}
                    </li>
                  ))}
                </ol>
              )}
              <p className="text-sm text-ink">
                {version.kind === "mcq"
                  ? `${version.multiple_choice ? "Several" : "One"} correct option${version.multiple_choice ? "s" : ""}.`
                  : `${version.sample_test_case_count} sample and ${version.hidden_test_case_count} hidden tests.`}{" "}
                Add it to an exam from{" "}
                <Link href="/staff/exams" className="text-brand hover:underline">
                  Exams
                </Link>
                .
              </p>
              <ActionForm action={draftNewVersion} submitLabel="Edit as a new draft" className="mt-4">
                <input type="hidden" name="question_id" value={version.question_id} />
              </ActionForm>
            </Panel>
          )}
        </div>
      </div>
      {ready && !choice && (
        <Section title="Check a model solution" description="Run a correct solution on every test before students do. A failing test usually means a wrong expected output.">
          <ModelCheckPanel versionId={version.id} languages={version.supported_languages} checks={checks} />
        </Section>
      )}
    </>
  );
}
