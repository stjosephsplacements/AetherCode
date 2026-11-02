import { ArrowLeft, Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmDelete } from "@/components/staff/confirm-delete";
import { EditDialog } from "@/components/staff/edit-dialog";
import { ActionForm } from "@/components/staff/form";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { type Step, Stepper } from "@/components/staff/stepper";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Badge, Panel } from "@/components/ui/card";
import type { ModelCheck, QuestionVersion } from "@/lib/api-types";
import { nameOf } from "@/lib/languages";
import { type CheckStatus, checkStatus, isVerified } from "@/lib/model-checks";
import { gateway } from "@/lib/server/gateway";
import { listCategories, listTagSuggestions } from "@/lib/server/categories";
import { listLanguages } from "@/lib/server/languages";
import { reviewerChoices } from "@/lib/server/reviewers";
import { requireStaff } from "@/lib/server/staff";
import { cn } from "@/lib/utils";
import { deleteDraftVersion, draftNewVersion, updateQuestionDetails } from "../actions";
import { AudienceSwitch } from "./audience-switch";
import { ChoicesEditor } from "./choices-editor";
import { ModelCheckPanel } from "./model-check";
import { Organise } from "./organise";
import { PublishPanel, publishBlocker } from "./publish-panel";
import { TestsEditor } from "./tests-editor";

export const metadata: Metadata = { title: "Question" };

const CHECK_NOTE: Record<CheckStatus, string> = {
  idle: "Not run yet",
  running: "Running now",
  verified: "Every test passes",
  failing: "Some tests fail",
  stale: "Tests changed, run again",
  unrunnable: "Could not run",
};

/** A numbered section of the workbench. */
function Section({ number, title, note, children, className }: { number: number; title: string; note?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={className} aria-labelledby={`section-${number}`}>
      <div className="mb-3 flex items-baseline gap-3">
        <span aria-hidden className="font-mono text-[12px] tabular-nums text-ink-subtle">
          0{number}
        </span>
        <div className="min-w-0">
          <h2 id={`section-${number}`} className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {title}
          </h2>
          {note && <p className="mt-0.5 text-[13px] text-ink-muted">{note}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

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
  const [{ languages }, categories, tagSuggestions] = await Promise.all([listLanguages(), listCategories(), listTagSuggestions()]);
  const filing = categories.length > 0 && (
    <Panel className="mt-6 p-5">
      <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Filing</h2>
      <Organise
        questionId={version.question_id}
        versionId={version.id}
        categories={categories}
        tagSuggestions={tagSuggestions}
        initial={{ categoryId: version.category_id ?? categories[0]!.id, tags: (version.tags ?? []).map((tag) => tag.name) }}
      />
    </Panel>
  );

  const draft = version.status === "draft";
  const mcq = version.kind === "mcq";
  // A multiple-choice draft has no languages until its options are saved (ADR-0035).
  const choice = mcq || version.supported_languages.length === 0;
  const tests = version.sample_test_case_count + version.hidden_test_case_count;
  const ready = choice ? mcq : version.sample_test_case_count > 0 && version.hidden_test_case_count > 0;
  const verified = isVerified(checks);
  const blocker = publishBlocker(version, verified);
  const reviewers = !blocker && requireReview && !version.review_requested_at ? await reviewerChoices(staff.tenantId, staff.viewer.principalId) : [];
  const status = checkStatus(checks);
  const limits = `${version.time_limit_ms / 1000} s, ${Math.round(version.memory_limit_kib / 1024)} MB`;

  const steps: Step[] = [
    { id: "details", label: "Details", note: mcq ? version.difficulty : `${version.difficulty}, ${limits}`, state: "done" },
    mcq || choice
      ? { id: "options", label: "Options", note: ready ? "Saved" : "None saved yet", state: ready ? "done" : "current" }
      : { id: "tests", label: "Test cases", note: ready ? `${version.sample_test_case_count} sample, ${version.hidden_test_case_count} hidden` : "None saved yet", state: ready ? "done" : "current" },
    ...(choice ? [] : [{ id: "verify", label: "Verify", note: CHECK_NOTE[status], state: !ready ? ("todo" as const) : verified ? ("done" as const) : ("current" as const) }]),
    { id: "publish", label: "Publish", note: draft ? (blocker ? "Locked until the steps above are done" : "Ready") : "Published", state: !draft ? "done" : blocker ? "locked" : "current" },
  ];

  return (
    <>
      <Link href="/staff/questions" className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink">
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        Questions
      </Link>
      <PageHeader
        title={version.title}
        description={mcq ? `Version ${version.version_number}, ${version.difficulty}, multiple choice` : `Version ${version.version_number}, ${version.difficulty}, ${limits}, ${version.supported_languages.map((key) => nameOf(languages, key)).join(", ")}`}
        actions={
          <>
            {!mcq && <AudienceSwitch questionId={version.question_id} versionId={version.id} initial={version.audience ?? "test"} />}
            <Badge tone={draft ? "neutral" : "success"}>{draft ? (version.review_requested_at ? "In review" : "Draft") : "Published"}</Badge>
            {draft && (
              <EditDialog
                title="Edit question"
                description="Changing the time or memory limit means the model solution has to be checked again."
                fields={[
                  { name: "title", label: "Title", value: version.title },
                  { name: "prompt", label: "Statement (Markdown)", value: version.prompt_markdown, kind: "textarea" },
                  {
                    name: "difficulty",
                    label: "Difficulty",
                    value: version.difficulty,
                    kind: "select",
                    options: [
                      { value: "easy", label: "Easy" },
                      { value: "medium", label: "Medium" },
                      { value: "hard", label: "Hard" },
                    ],
                  },
                  ...(mcq
                    ? []
                    : [
                        { name: "time_seconds", label: "Time limit (seconds)", value: String(version.time_limit_ms / 1000), kind: "number" as const, min: 0.05, max: 600, step: 0.05 },
                        { name: "memory_mb", label: "Memory limit (MB)", value: String(Math.round(version.memory_limit_kib / 1024)), kind: "number" as const, min: 1, max: 4096 },
                      ]),
                ]}
                onSave={async (changes) => {
                  "use server";
                  return updateQuestionDetails(versionId, version.version, changes);
                }}
              />
            )}
            {draft && (
              <ConfirmDelete
                label="Delete draft"
                title={`Delete ${version.title}?`}
                description="Only this draft goes. A question that was published before cannot be deleted, exams may pin it."
                redirectTo="/staff/questions"
                onConfirm={async (reason) => {
                  "use server";
                  return deleteDraftVersion(versionId, reason);
                }}
              />
            )}
            {/* Exports carry the hidden tests: administrators only, and each is logged (ADR-0032). */}
            {staff.canManageAccounts && !mcq && version.hidden_test_case_count > 0 && (
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

      <Stepper steps={steps} label="Question steps" />
      {filing}

      {draft ? (
        <div className="mt-8 grid gap-x-8 gap-y-10 xl:grid-cols-12">
          <div className="min-w-0 space-y-10 xl:col-span-5">
            <Section number={1} title="Statement">
              <Panel className="p-5">
                <Markdown>{version.prompt_markdown}</Markdown>
              </Panel>
              <p className="mt-2 text-xs text-ink-muted">A saved draft&apos;s statement and limits are fixed. To change them, write the question again.</p>
            </Section>

            <Section
              number={2}
              title={choice ? "Options" : "Test cases"}
              note={choice ? undefined : ready ? `${version.sample_test_case_count} sample, ${version.hidden_test_case_count} hidden, saved encrypted` : "None saved yet"}
            >
              {choice ? (
                <ChoicesEditor versionId={version.id} expectedVersion={version.version} initial={{ choices: version.choices ?? [], correct: version.correct_choices ?? [], multiple: version.multiple_choice, explanations: version.choice_explanations ?? [] }} />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <TestsEditor versionId={version.id} expectedVersion={version.version} existing={tests} />
                  <span className="text-[13px] text-ink-muted">Saved tests cannot be shown again. Replacing them asks for a new check.</span>
                </div>
              )}
            </Section>
          </div>

          <div className="min-w-0 space-y-10 xl:col-span-7">
            {!choice && (
              <Section number={3} title="Verify" note="Write a correct solution. Every test has to pass before this question can be published.">
                {ready ? (
                  <ModelCheckPanel versionId={version.id} languages={languages} supported={version.supported_languages} checks={checks} tests={tests} />
                ) : (
                  <p className="rounded-[var(--radius-surface)] border border-dashed border-line-strong px-6 py-10 text-center text-sm text-ink-muted">Save at least one sample and one hidden test to unlock the editor.</p>
                )}
              </Section>
            )}
            <Section number={choice ? 3 : 4} title="Publish">
              <Panel className={cn("p-5", blocker && "border-dashed")}>
                <PublishPanel version={version} blocker={blocker} requireReview={requireReview} reviewers={reviewers} viewerId={staff.viewer.principalId} />
              </Panel>
            </Section>
          </div>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <Panel className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">Statement</h2>
            <Markdown>{version.prompt_markdown}</Markdown>
          </Panel>
          <Panel className="h-fit p-5">
            {mcq && (
              <ol className="mb-4 space-y-1.5 text-sm">
                {(version.choices ?? []).map((option, index) => (
                  <li key={index} className={version.correct_choices?.includes(index) ? "font-medium text-success" : "text-ink"}>
                    {String.fromCharCode(65 + index)}. {option}
                    {version.correct_choices?.includes(index) && " (correct)"}
                    {version.choice_explanations?.[index] && <span className="block text-[12.5px] font-normal text-ink-muted">{version.choice_explanations[index]}</span>}
                  </li>
                ))}
              </ol>
            )}
            <p className="text-sm text-ink">
              {mcq ? `${version.multiple_choice ? "Several" : "One"} correct option${version.multiple_choice ? "s" : ""}.` : `${version.sample_test_case_count} sample and ${version.hidden_test_case_count} hidden tests.`} Add it to an exam from{" "}
              <Link href="/staff/exams" className="text-brand hover:underline">
                Exams
              </Link>
              .
            </p>
            <ActionForm action={draftNewVersion} submitLabel="Edit as a new draft" className="mt-4">
              <input type="hidden" name="question_id" value={version.question_id} />
            </ActionForm>
          </Panel>
        </div>
      )}
    </>
  );
}
