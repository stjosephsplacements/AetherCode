"use client";

import { ArrowLeft, ArrowRight, Check, ChevronRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createDraft } from "@/app/staff/questions/actions";
import { Markdown } from "@/components/markdown";
import { Checkbox, Field, Radio, RadioGroup, Select, TextArea, TextInput } from "@/components/staff/form";
import { CategoryPicker } from "@/components/staff/category-picker";
import { type Step, Stepper } from "@/components/staff/stepper";
import { type TagSuggestion, TagInput } from "@/components/staff/tag-input";
import { Button } from "@/components/ui/button";
import { Badge, Panel } from "@/components/ui/card";
import type { CategoryRef } from "@/lib/api-types";
import { type Language, nameOf } from "@/lib/languages";
import { cn } from "@/lib/utils";
import { ChoicesFields, blankChoices } from "./choices-fields";
import { type Details, type Difficulty, LIMITS, type TestDraft, blankDetails, blankTest, choicesProblem, detailsProblem, slugOf, summarizeTests, testsProblem } from "./model";
import { TestCasesEditor } from "./test-cases-editor";

type StepId = "details" | "content" | "review";
const ORDER: StepId[] = ["details", "content", "review"];

const KINDS = [
  { value: "coding", label: "Coding", hint: "Students write code. Tests decide the marks." },
  { value: "mcq", label: "Multiple choice", hint: "Students pick one or more options." },
] as const;

/**
 * Writes a question in three steps without saving anything: details, then the
 * tests (or the options), then a review. Saving creates the draft once; a
 * coding question is then verified with a model solution before it can be
 * published, so nothing here can reach students untested.
 */
export function QuestionWizard({ languages, categories: initialCategories, tagSuggestions }: { languages: Language[]; categories: CategoryRef[]; tagSuggestions: TagSuggestion[] }) {
  const router = useRouter();
  const [categories, setCategories] = useState(initialCategories);
  const [details, setDetails] = useState<Details>(() => blankDetails(languages.map((language) => language.key)));
  const [tests, setTests] = useState<TestDraft[]>(() => [{ ...blankTest(true) }, { ...blankTest(false) }]);
  const [choices, setChoices] = useState(blankChoices);
  const [step, setStep] = useState<StepId>("details");
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [saving, startSaving] = useTransition();

  const mcq = details.kind === "mcq";
  const at = ORDER.indexOf(step);
  const change = (patch: Partial<Details>) => {
    setDetails((current) => ({ ...current, ...patch }));
    setError(null);
  };

  // Nothing is saved until the last step, so warn before the work is lost.
  const dirty = !done && (details.title.trim() !== "" || details.prompt.trim() !== "");
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const steps: Step[] = [
    { id: "details", label: "Details", note: details.title.trim() || "Title, statement, limits" },
    { id: "content", label: mcq ? "Options" : "Test cases", note: mcq ? "The answer key" : `${summarizeTests(tests).sample} sample, ${summarizeTests(tests).hidden} hidden` },
    { id: "review", label: "Review and save", note: mcq ? "Then publish" : "Then verify" },
  ].map((entry, index) => ({ ...entry, id: entry.id, state: index < at ? "done" : index === at ? "current" : "todo" }));

  function next() {
    const problem = step === "details" ? detailsProblem(details, { categories: categories.length > 0 }) : mcq ? choicesProblem(choices) : testsProblem(tests);
    if (problem) return setError(problem);
    setError(null);
    setStep(ORDER[at + 1]!);
  }

  function save() {
    setError(null);
    startSaving(async () => {
      const result = await createDraft({ details, tests: mcq ? undefined : tests, choices: mcq ? choices : undefined });
      if (result.versionId) setSavedId(result.versionId);
      if (result.error) return setError(result.error);
      setDone(true);
      router.push(`/staff/questions/${result.versionId}`);
    });
  }

  return (
    <div className="space-y-6">
      <Stepper steps={steps} label="Question steps" onSelect={(id) => setStep(id as StepId)} />

      {step === "details" && (
        <div className="space-y-6">
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-ink">Type</legend>
            <RadioGroup value={details.kind} onValueChange={(value) => change({ kind: value as Details["kind"] })} className="grid gap-2 sm:grid-cols-2">
              {KINDS.map((kind) => (
                <label
                  key={kind.value}
                  className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-line bg-surface px-4 py-3 transition-colors hover:border-line-strong has-[[data-state=checked]]:border-brand has-[[data-state=checked]]:bg-brand-soft"
                >
                  <Radio value={kind.value} className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium text-ink">{kind.label}</span>
                    <span className="block text-xs text-ink-muted">{kind.hint}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
            <Field label="Title" htmlFor="question-title">
              <TextInput id="question-title" value={details.title} onChange={(event) => change({ title: event.target.value })} maxLength={300} placeholder="Sum of two numbers" autoFocus />
            </Field>
            <Field label="Difficulty" htmlFor="question-difficulty">
              <Select id="question-difficulty" value={details.difficulty} onValueChange={(value) => change({ difficulty: value as Difficulty })}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {categories.length > 0 && (
              <Field label="Category" htmlFor="question-category" hint="Where staff find it. Inside a category, questions are told apart by difficulty and tags.">
                <CategoryPicker
                  id="question-category"
                  categories={categories}
                  value={details.categoryId}
                  onChange={(categoryId) => change({ categoryId })}
                  onCreated={(category) => setCategories((list) => [...list.filter((entry) => entry.id !== category.id), category])}
                />
              </Field>
            )}
            <Field label="Tags" htmlFor="question-tags">
              <TagInput id="question-tags" value={details.tags} onChange={(tags) => change({ tags })} suggestions={tagSuggestions} />
            </Field>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Statement" htmlFor="question-prompt" hint="Markdown: headings, lists, `code` and fenced code blocks.">
              <TextArea
                id="question-prompt"
                value={details.prompt}
                onChange={(event) => change({ prompt: event.target.value })}
                placeholder={"Read two integers a and b and print their sum.\n\n### Input\nOne line with `a b`.\n\n### Output\nPrint `a + b`."}
                className="min-h-72 font-mono text-[13px]"
              />
            </Field>
            <div className="space-y-1.5">
              <p className="text-[13px] font-medium text-ink">What students will see</p>
              <Panel className="min-h-72 overflow-auto p-5">{details.prompt.trim() ? <Markdown>{details.prompt}</Markdown> : <p className="text-sm text-ink-muted">The statement appears here as you write it.</p>}</Panel>
            </div>
          </div>

          {!mcq && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <fieldset>
                <legend className="mb-1.5 text-[13px] font-medium text-ink">Languages students may use</legend>
                <div className="flex flex-wrap gap-2">
                  {languages.map((language) => (
                    <label
                      key={language.key}
                      className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm transition-colors hover:border-line-strong has-[[data-state=checked]]:border-brand has-[[data-state=checked]]:bg-brand-soft"
                    >
                      <Checkbox
                        checked={details.languages.includes(language.key)}
                        onCheckedChange={(checked) => change({ languages: checked === true ? [...details.languages, language.key] : details.languages.filter((key) => key !== language.key) })}
                      />
                      {language.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Time limit (seconds)" htmlFor="question-time">
                  <TextInput id="question-time" type="number" min={LIMITS.timeSeconds.min} max={LIMITS.timeSeconds.max} step={0.1} value={details.timeSeconds} onChange={(event) => change({ timeSeconds: Number(event.target.value) })} />
                </Field>
                <Field label="Memory limit (MB)" htmlFor="question-memory">
                  <TextInput id="question-memory" type="number" min={LIMITS.memoryMb.min} max={LIMITS.memoryMb.max} value={details.memoryMb} onChange={(event) => change({ memoryMb: Number(event.target.value) })} />
                </Field>
              </div>
            </div>
          )}

          <div className="rounded-[var(--radius-control)] border border-line bg-surface">
            <button
              type="button"
              aria-expanded={advanced}
              aria-controls="question-advanced"
              onClick={() => setAdvanced((open) => !open)}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] font-medium text-ink-muted transition-colors hover:text-ink"
            >
              <ChevronRight className={cn("size-4 transition-transform duration-200", advanced && "rotate-90")} strokeWidth={1.75} />
              Advanced
            </button>
            {advanced && (
              <div id="question-advanced" className="max-w-sm px-4 pb-4">
                <Field label="Slug" htmlFor="question-slug" hint={`A short unique id. Made from the title if empty${details.title.trim() ? `: ${slugOf(details) || "needs a title"}` : "."}`}>
                  <TextInput id="question-slug" value={details.slug} onChange={(event) => change({ slug: event.target.value.toLowerCase() })} placeholder="sum-of-two-numbers" />
                </Field>
              </div>
            )}
          </div>
        </div>
      )}

      {step === "content" && (
        <div className="space-y-3">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{mcq ? "Options and the correct answer" : "Test cases"}</h2>
            <p className="mt-0.5 max-w-[72ch] text-[13px] text-ink-muted">
              {mcq
                ? "Students see the options in a shuffled order."
                : "Sample tests are shown to students when they run their code. Hidden tests decide the marks. Next you write a model solution and it has to pass every one of them before the question can be published."}
            </p>
          </div>
          {mcq ? <ChoicesFields value={choices} onChange={(value) => { setChoices(value); setError(null); }} /> : <TestCasesEditor tests={tests} onChange={(value) => { setTests(value); setError(null); }} />}
        </div>
      )}

      {step === "review" && <Review details={details} tests={tests} choices={choices} languages={languages} categories={categories} />}

      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}{" "}
          {savedId && (
            <Link href={`/staff/questions/${savedId}`} className="font-medium underline underline-offset-4">
              Open the draft
            </Link>
          )}
        </p>
      )}

      <div className="flex items-center justify-between border-t border-line pt-5">
        <Button type="button" variant="ghost" onClick={() => setStep(ORDER[at - 1]!)} disabled={at === 0 || saving} className={cn(at === 0 && "invisible")}>
          <ArrowLeft />
          Back
        </Button>
        {step === "review" ? (
          <Button type="button" size="lg" onClick={save} disabled={saving}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Check />}
            {mcq ? "Save draft" : "Save draft and verify"}
          </Button>
        ) : (
          <Button type="button" onClick={next}>
            Continue
            <ArrowRight />
          </Button>
        )}
      </div>
    </div>
  );
}

function Review({ details, tests, choices, languages, categories }: { details: Details; tests: TestDraft[]; choices: { options: string[]; correct: number[] }; languages: Language[]; categories: CategoryRef[] }) {
  const mcq = details.kind === "mcq";
  const summary = summarizeTests(tests);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="space-y-3 p-5">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Details</h2>
          <p className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{details.title}</p>
          <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-2 text-sm">
            <dt className="text-ink-muted">Difficulty</dt>
            <dd className="text-ink capitalize">{details.difficulty}</dd>
            {categories.length > 0 && (
              <>
                <dt className="text-ink-muted">Category</dt>
                <dd className="text-ink">{categories.find((category) => category.id === details.categoryId)?.name ?? "none"}</dd>
              </>
            )}
            <dt className="text-ink-muted">Tags</dt>
            <dd className="text-ink">{details.tags.length ? details.tags.join(", ") : "none"}</dd>
            <dt className="text-ink-muted">Slug</dt>
            <dd className="font-mono text-[13px] text-ink">{slugOf(details)}</dd>
            {!mcq && (
              <>
                <dt className="text-ink-muted">Languages</dt>
                <dd className="text-ink">{details.languages.map((key) => nameOf(languages, key)).join(", ")}</dd>
                <dt className="text-ink-muted">Limits</dt>
                <dd className="font-mono text-[13px] text-ink">
                  {details.timeSeconds} s, {details.memoryMb} MB
                </dd>
              </>
            )}
          </dl>
        </Panel>
        <Panel className="space-y-3 p-5">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">{mcq ? "Options" : "Test cases"}</h2>
          {mcq ? (
            <ol className="space-y-1.5 text-sm">
              {choices.options.map((option, index) => (
                <li key={index} className={choices.correct.includes(index) ? "font-medium text-success" : "text-ink"}>
                  {String.fromCharCode(65 + index)}. {option}
                  {choices.correct.includes(index) && " (correct)"}
                </li>
              ))}
            </ol>
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
              <Badge tone="brand">{summary.sample} sample</Badge>
              <Badge>{summary.hidden} hidden</Badge>
              <span className="text-ink-muted">worth {summary.weight} marks in total</span>
            </p>
          )}
        </Panel>
      </div>
      <Panel className="p-5">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">What happens next</h2>
        <ol className="mt-3 space-y-2.5 text-sm text-ink">
          <li>
            <span className="font-medium">Saved as your draft.</span> <span className="text-ink-muted">Only you can see it until it is published.</span>
          </li>
          {mcq ? (
            <li>
              <span className="font-medium">Publish it.</span> <span className="text-ink-muted">A multiple-choice question runs no code, so there is nothing to verify.</span>
            </li>
          ) : (
            <>
              <li>
                <span className="font-medium">Write a model solution</span> <span className="text-ink-muted">in the code editor and run it on every test, hidden ones included.</span>
              </li>
              <li>
                <span className="font-medium">Publish once every test passes.</span> <span className="text-ink-muted">Until then the question cannot be published, and replacing the tests asks for a new check.</span>
              </li>
            </>
          )}
        </ol>
      </Panel>
    </div>
  );
}
