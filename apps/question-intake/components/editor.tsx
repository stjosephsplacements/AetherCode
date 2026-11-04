"use client";

import { ArrowLeft, ArrowRight, CheckCircle, CircleNotch, MagicWand, Plus, ShieldCheck, Trash, WarningCircle, XCircle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { deleteQuestion, saveQuestion } from "@/app/questions/actions";
import { createTopic } from "@/app/topics/actions";
import { Checkbox } from "@/components/checkbox";
import { CodeEditor } from "@/components/code-editor";
import { Markdown } from "@/components/markdown";
import { Select } from "@/components/select";
import { type Step, Stepper } from "@/components/stepper";
import { TagInput } from "@/components/tag-input";
import { Button, Label, Panel, field } from "@/components/ui";
import { cn } from "@/lib/cn";
import { type Draft, type StepId, blankTest, stepProblem, stepsFor, toPayload } from "@/lib/draft";
import { toPlatformMarkdown } from "@/lib/format";
import { LANGUAGES, type LanguageId } from "@/lib/languages";
import { DIFFICULTIES, cleanTags, slugify } from "@/lib/platform";
import type { Verification } from "@/lib/verify";

type TopicRef = { id: string; name: string; parent_id: string | null };
type Checked = { result: Verification; token: string | null; key: string };

const LABELS: Record<StepId, string> = { details: "Topic and details", statement: "Statement", tests: "Test cases", solutions: "Model solutions", options: "Options", verify: "Verify and save" };

const SECTION_TEMPLATE = "\n\n## Input Format\n\n\n\n## Output Format\n\n\n\n## Constraints\n\n- \n";

/** The signature of what a judge run covers; when it changes, the question has to be verified again. */
const covered = (draft: Draft) => {
  const p = toPayload(draft);
  return JSON.stringify([p.title.trim(), toPlatformMarkdown(p.prompt_markdown).markdown, p.difficulty, p.languages, p.time_limit_ms, p.memory_limit_kib, p.tests, [...p.solutions].sort((a, b) => a.language.localeCompare(b.language)), p.templates]);
};

const topicOptions = (topics: TopicRef[]) => {
  const out: { value: string; label: string }[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const topic of topics.filter((entry) => entry.parent_id === parent).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ value: topic.id, label: `${depth > 0 ? "\u00a0\u00a0\u21b3 " : ""}${topic.name}` });
      visit(topic.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
};

/**
 * Writes a question in the platform's own shape, in guided steps: topic and difficulty first, then the statement,
 * the tests and a model solution (or the options of a multiple-choice question), then the judge. A coding question
 * is saved only after every model solution has passed every test, and any later change needs verifying again.
 */
export function QuestionEditor({ id, initial, topics: initialTopics, canDelete }: { id: string | null; initial: Draft; topics: TopicRef[]; canDelete: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(initial);
  const [topics, setTopics] = useState(initialTopics);
  const [step, setStep] = useState<StepId>("details");
  const [problem, setProblem] = useState<string | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [saving, startSaving] = useTransition();
  const [tab, setTab] = useState<LanguageId>(() => initial.languages[0] ?? "python3");
  const [done, setDone] = useState(false);
  const [converted, setConverted] = useState(false);
  const [newTopic, setNewTopic] = useState<{ name: string; parent: string } | null>(null);

  const coding = draft.kind === "coding";
  const order = stepsFor(draft.kind);
  const at = order.indexOf(step);
  const editing = id !== null;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setProblem(null);
  };
  const key = useMemo(() => covered(draft), [draft]);
  const fresh = checked !== null && checked.key === key;
  const ready = coding ? fresh && checked.token !== null : true;
  const formatted = useMemo(() => toPlatformMarkdown(draft.prompt), [draft.prompt]);

  // Nothing is saved until the last step, so warn before the work is lost.
  const dirty = !done && JSON.stringify(toPayload(draft)) !== JSON.stringify(toPayload(initial));
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const steps: Step[] = order.map((entry, index) => ({
    id: entry,
    label: LABELS[entry],
    note: entry === "details" ? draft.title.trim() || "Topic, difficulty, title" : entry === "tests" ? `${draft.tests.filter((t) => t.is_sample).length} sample, ${draft.tests.filter((t) => !t.is_sample).length} hidden` : entry === "solutions" ? `${draft.languages.filter((l) => (draft.solutions[l] ?? "").trim()).length} of ${draft.languages.length} languages` : entry === "options" ? `${draft.choices.length} options` : entry === "verify" ? (coding ? "The judge checks it" : "Review, then save") : "What students read",
    // An existing question opens at any step; a new one is walked through in order.
    state: entry === step ? "current" : editing || index < at ? "done" : "todo",
  }));

  function go(next: StepId) {
    setProblem(null);
    setStep(next);
  }

  function forward() {
    const found = stepProblem(step, draft);
    if (found) return setProblem(found);
    go(order[at + 1]!);
  }

  function firstProblem(): { step: StepId; message: string } | null {
    for (const entry of order.slice(0, -1)) {
      const found = stepProblem(entry, draft);
      if (found) return { step: entry, message: found };
    }
    return null;
  }

  async function verify() {
    const found = firstProblem();
    if (found) {
      setStep(found.step);
      return setProblem(found.message);
    }
    setVerifying(true);
    setMessage(null);
    try {
      const response = await fetch("/api/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(toPayload(draft)) });
      const body = (await response.json()) as Verification & { token: string | null; error?: string };
      if (!response.ok) {
        setChecked(null);
        setMessage(body.error ?? "The judge could not verify the question.");
        return;
      }
      setChecked({ result: body, token: body.token, key: covered(draft) });
    } catch {
      setMessage("The judge could not be reached. Try again in a moment.");
    } finally {
      setVerifying(false);
    }
  }

  function save() {
    const found = firstProblem();
    if (found) {
      setStep(found.step);
      return setProblem(found.message);
    }
    if (!ready) return;
    startSaving(async () => {
      const result = await saveQuestion(id, toPayload(draft), checked?.token ?? null);
      if ("error" in result) setMessage(result.error);
      else {
        setDone(true);
        router.push(`/topics/${result.topicId}?difficulty=${draft.difficulty}`);
      }
    });
  }

  async function addTopic() {
    if (!newTopic) return;
    const result = await createTopic(newTopic.name, newTopic.parent || null);
    if ("error" in result) return setProblem(result.error);
    setTopics((current) => (current.some((topic) => topic.id === result.id) ? current : [...current, { id: result.id, name: newTopic.name.trim(), parent_id: newTopic.parent || null }]));
    set("topicId", result.id);
    setNewTopic(null);
  }

  const test = (index: number, patch: Partial<Draft["tests"][number]>) => set("tests", draft.tests.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));
  const language = draft.languages.includes(tab) ? tab : draft.languages[0];
  const template = language ? (draft.templates[language] ?? { starter: "", prefix: "", suffix: "" }) : null;
  const options = topicOptions(topics);

  return (
    <div className="space-y-5">
      <Stepper steps={steps} label="Question steps" onSelect={(entry) => go(entry as StepId)} />

      {step === "details" && (
        <Panel className="space-y-5">
          {!editing && (
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium">Type</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {([["coding", "Coding", "Students write code. Tests decide the marks."], ["mcq", "Multiple choice", "Students pick one or more options."]] as const).map(([value, label, hint]) => (
                  <button key={value} type="button" role="radio" aria-checked={draft.kind === value} onClick={() => { set("kind", value); setChecked(null); }} className={cn("rounded-[var(--radius-control)] border px-4 py-3 text-left transition-colors", draft.kind === value ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-line-strong")}>
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-xs text-ink-muted">{hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div>
              <Label htmlFor="topic">Topic</Label>
              {options.length > 0 ? <Select id="topic" value={draft.topicId} onValueChange={(value) => set("topicId", value)} options={options} placeholder="Choose a topic" /> : <p className="rounded-[var(--radius-control)] border border-dashed border-line-strong px-3 py-2.5 text-[13.5px] text-ink-muted">No topics yet. Create the first one.</p>}
            </div>
            <div className="flex items-end">
              <Button variant="secondary" onClick={() => setNewTopic(newTopic ? null : { name: "", parent: "" })}>
                <Plus className="size-3.5" /> New topic
              </Button>
            </div>
          </div>
          {newTopic && (
            <div className="grid gap-3 rounded-[var(--radius-control)] border border-line bg-surface-2 p-3 md:grid-cols-[1fr_1fr_auto]">
              <input aria-label="Topic name" autoFocus value={newTopic.name} onChange={(event) => setNewTopic({ ...newTopic, name: event.target.value })} placeholder="Arrays" className={field} />
              <Select aria-label="Parent topic" value={newTopic.parent || "none"} onValueChange={(value) => setNewTopic({ ...newTopic, parent: value === "none" ? "" : value })} options={[{ value: "none", label: "No parent (top level)" }, ...topics.filter((topic) => !topic.parent_id).map((topic) => ({ value: topic.id, label: `Inside ${topic.name}` }))]} />
              <Button onClick={addTopic} disabled={!newTopic.name.trim()}>Create topic</Button>
            </div>
          )}

          <div>
            <Label>Difficulty</Label>
            <div role="radiogroup" aria-label="Difficulty" className="flex gap-2">
              {DIFFICULTIES.map((level) => (
                <button key={level} type="button" role="radio" aria-checked={draft.difficulty === level} onClick={() => set("difficulty", level)} className={cn("rounded-full border px-5 py-1.5 text-[13.5px] capitalize transition-colors", draft.difficulty === level ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line-strong text-ink-muted hover:bg-hover")}>
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="title">Title</Label>
            <input id="title" value={draft.title} onChange={(event) => set("title", event.target.value)} className={field} placeholder="Sum of two numbers" maxLength={300} />
          </div>
          <div>
            <Label htmlFor="tags" hint="press Enter after each">Tags</Label>
            <TagInput id="tags" value={draft.tags} onChange={(value) => set("tags", cleanTags(value))} placeholder="two-pointers, hash-map" />
          </div>

          {coding && (
            <>
              <div>
                <Label>Languages students can use</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(LANGUAGES) as LanguageId[]).map((entry) => {
                    const on = draft.languages.includes(entry);
                    return (
                      <button key={entry} type="button" aria-pressed={on} onClick={() => set("languages", on ? draft.languages.filter((item) => item !== entry) : [...draft.languages, entry])} className={cn("rounded-full border px-3 py-1 text-[13px] transition-colors", on ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line-strong text-ink-muted hover:bg-hover")}>
                        {LANGUAGES[entry].label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="time" hint="seconds per test">Time limit</Label>
                  <input id="time" type="number" step="0.1" min={0.1} max={60} value={draft.timeSeconds} onChange={(event) => set("timeSeconds", Number(event.target.value))} className={field} />
                </div>
                <div>
                  <Label htmlFor="memory" hint="MB">Memory limit</Label>
                  <input id="memory" type="number" min={16} max={2048} value={draft.memoryMb} onChange={(event) => set("memoryMb", Number(event.target.value))} className={field} />
                </div>
              </div>
            </>
          )}

          <details className="rounded-[var(--radius-control)] border border-line px-3 py-2 text-[13.5px]">
            <summary className="cursor-pointer text-ink-muted">Advanced</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="slug" hint="a-z, 0-9 and hyphens">Slug</Label>
                <input id="slug" value={draft.slug} onChange={(event) => set("slug", event.target.value)} className={field} placeholder={slugify(draft.title) || "sum-of-two-numbers"} />
              </div>
              <div>
                <Label htmlFor="audience">Where it is used</Label>
                <Select id="audience" value={draft.audience} onValueChange={(value) => set("audience", value as Draft["audience"])} options={[{ value: "practice", label: "Practice and exams" }, { value: "test", label: "Exams only" }]} />
              </div>
            </div>
          </details>
        </Panel>
      )}

      {step === "statement" && (
        <Panel>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold">Statement</h2>
              <p className="text-[13px] text-ink-muted">
                Markdown with LaTeX maths: <code className="rounded bg-hover px-1">$x^2$</code> inline, <code className="rounded bg-hover px-1">$$\sum_{"{i=1}"}^{"{n}"} a_i$$</code> as a block. Paste plain text and it is converted to the platform format.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => { set("prompt", formatted.markdown); setConverted(true); }} disabled={!formatted.changed}>
                <MagicWand className="size-3.5" /> Convert to platform format
              </Button>
              <Button variant="ghost" onClick={() => set("prompt", `${draft.prompt.trimEnd()}${SECTION_TEMPLATE}`)}>Add sections</Button>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <CodeEditor path="statement.md" language="markdown" value={draft.prompt} onChange={(value) => { set("prompt", value); setConverted(false); }} height={460} wrap />
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[13px]">
                <span className="font-medium">Preview, as saved</span>
                {formatted.changed ? <span className="text-warning">Plain text found: it is converted when you save</span> : converted ? <span className="text-success">In the platform format</span> : null}
              </div>
              <div className="h-[460px] overflow-auto rounded-[var(--radius-control)] border border-line bg-surface-2 p-4">
                {formatted.markdown.trim() ? <Markdown>{formatted.markdown}</Markdown> : <p className="text-ink-subtle">The statement appears here.</p>}
              </div>
            </div>
          </div>
        </Panel>
      )}

      {step === "tests" && (
        <Panel>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-semibold">Test cases</h2>
              <p className="text-[13px] text-ink-muted">Samples are shown to students. Hidden tests decide the marks; weights split them.</p>
            </div>
            <Button variant="secondary" onClick={() => set("tests", [...draft.tests, blankTest(false)])}>
              <Plus className="size-3.5" /> Add test
            </Button>
          </div>
          <div className="space-y-3">
            {draft.tests.map((entry, index) => (
              <div key={index} className="rounded-[var(--radius-control)] border border-line p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <span className="font-mono text-ink-muted">Test {index + 1}</span>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-ink-muted">
                      Weight
                      <input type="number" min={1} max={100} value={entry.weight} onChange={(event) => test(index, { weight: Number(event.target.value) })} aria-label={`Test ${index + 1} weight`} className={`${field} !h-8 !w-16 !px-2 !py-0`} />
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-ink-muted">
                      <Checkbox checked={entry.is_sample} onCheckedChange={(value) => test(index, { is_sample: value === true })} aria-label={`Test ${index + 1} is a sample`} />
                      Sample (students see it)
                    </label>
                    <button aria-label={`Remove test ${index + 1}`} disabled={draft.tests.length <= 1} onClick={() => set("tests", draft.tests.filter((_, at) => at !== index))} className="text-ink-subtle hover:text-danger disabled:opacity-30">
                      <Trash className="size-4" />
                    </button>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <textarea aria-label={`Test ${index + 1} input`} placeholder="Input" value={entry.input} onChange={(event) => test(index, { input: event.target.value })} rows={3} className={`${field} font-mono text-[13px]`} />
                  <textarea aria-label={`Test ${index + 1} expected output`} placeholder="Expected output" value={entry.expected_output} onChange={(event) => test(index, { expected_output: event.target.value })} rows={3} className={`${field} font-mono text-[13px]`} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {step === "solutions" && language && template && (
        <Panel>
          <h2 className="mb-1 text-[15px] font-semibold">Model solutions</h2>
          <p className="mb-3 text-[13px] text-ink-muted">Write a working solution in at least one language. The judge runs each one against every test; all must pass.</p>
          <div role="tablist" aria-label="Language" className="mb-3 flex flex-wrap gap-1.5">
            {draft.languages.map((entry) => {
              const filled = (draft.solutions[entry] ?? "").trim() !== "";
              return (
                <button key={entry} role="tab" aria-selected={language === entry} onClick={() => setTab(entry)} className={cn("rounded-full border px-3 py-1 text-[13px] transition-colors", language === entry ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line-strong text-ink-muted hover:bg-hover")}>
                  {LANGUAGES[entry].label}
                  {filled && <span aria-hidden className="ml-1.5 inline-block size-1.5 rounded-full bg-success" />}
                </button>
              );
            })}
          </div>
          <CodeEditor path={`solution-${language}`} language={LANGUAGES[language].monaco} value={draft.solutions[language] ?? LANGUAGES[language].template} onChange={(source) => set("solutions", { ...draft.solutions, [language]: source === LANGUAGES[language].template ? "" : source })} />
          <p className="mt-2 text-[12.5px] text-ink-subtle">The starter code is only a template: a language counts once you change it.</p>
          <details className="mt-4 rounded-[var(--radius-control)] border border-line px-3 py-2 text-[13.5px]">
            <summary className="cursor-pointer text-ink-muted">Function-only question: starter code and wrapper for {LANGUAGES[language].label}</summary>
            <p className="mt-2 text-[12.5px] text-ink-muted">Students see only the starter code and write the function. The judge runs your wrapper before and after it, and your model solution above is the function.</p>
            {(["starter", "prefix", "suffix"] as const).map((part) => (
              <div key={part} className="mt-3">
                <Label htmlFor={`template-${part}`}>{part === "starter" ? "Starter code (shown to students)" : part === "prefix" ? "Wrapper before the function (hidden)" : "Wrapper after the function (hidden)"}</Label>
                <textarea id={`template-${part}`} value={template[part]} onChange={(event) => set("templates", { ...draft.templates, [language]: { ...template, [part]: event.target.value } })} rows={part === "starter" ? 4 : 5} spellCheck={false} className={`${field} font-mono text-[13px]`} />
              </div>
            ))}
          </details>
        </Panel>
      )}

      {step === "options" && (
        <Panel>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-semibold">Options</h2>
              <p className="text-[13px] text-ink-muted">Tick the correct answer. Maths in an option, like n^2, is converted to LaTeX on save.</p>
            </div>
            <Button variant="secondary" disabled={draft.choices.length >= 12} onClick={() => setDraft((current) => ({ ...current, choices: [...current.choices, ""], explanations: [...current.explanations, ""] }))}>
              <Plus className="size-3.5" /> Add option
            </Button>
          </div>
          <label className="mb-3 flex cursor-pointer items-center gap-2 text-[13.5px] text-ink-muted">
            <Checkbox checked={draft.multiple} onCheckedChange={(value) => setDraft((current) => ({ ...current, multiple: value === true, correct: value === true ? current.correct : current.correct.slice(0, 1) }))} aria-label="More than one answer is correct" />
            More than one answer can be correct
          </label>
          <div className="space-y-3">
            {draft.choices.map((choice, index) => (
              <div key={index} className="rounded-[var(--radius-control)] border border-line p-3">
                <div className="flex items-center gap-3">
                  <Checkbox checked={draft.correct.includes(index)} aria-label={`Option ${index + 1} is correct`} onCheckedChange={(value) => setDraft((current) => ({ ...current, correct: value === true ? (current.multiple ? [...current.correct, index] : [index]) : current.correct.filter((entry) => entry !== index) }))} />
                  <input aria-label={`Option ${index + 1}`} value={choice} onChange={(event) => set("choices", draft.choices.map((entry, at) => (at === index ? event.target.value : entry)))} placeholder={`Option ${index + 1}`} className={field} />
                  <button aria-label={`Remove option ${index + 1}`} disabled={draft.choices.length <= 2} onClick={() => setDraft((current) => ({ ...current, choices: current.choices.filter((_, at) => at !== index), explanations: current.explanations.filter((_, at) => at !== index), correct: current.correct.filter((entry) => entry !== index).map((entry) => (entry > index ? entry - 1 : entry)) }))} className="text-ink-subtle hover:text-danger disabled:opacity-30">
                    <Trash className="size-4" />
                  </button>
                </div>
                <input aria-label={`Why option ${index + 1} is right or wrong`} value={draft.explanations[index] ?? ""} onChange={(event) => set("explanations", draft.choices.map((_, at) => (at === index ? event.target.value : (draft.explanations[at] ?? ""))))} placeholder="Why it is right or wrong (optional)" className={`${field} mt-2`} />
              </div>
            ))}
          </div>
        </Panel>
      )}

      {step === "verify" && (
        <div className="space-y-4">
          <Panel>
            <h2 className="mb-3 text-[15px] font-semibold">{coding ? "Ready for the judge" : "Ready to save"}</h2>
            <ul className="grid gap-2 text-[13.5px] sm:grid-cols-2">
              {order.slice(0, -1).map((entry) => {
                const found = stepProblem(entry, draft);
                return (
                  <li key={entry} className="flex items-start gap-2">
                    {found ? <WarningCircle className="mt-0.5 size-4 shrink-0 text-warning" /> : <CheckCircle className="mt-0.5 size-4 shrink-0 text-success" weight="fill" />}
                    <span>
                      <button type="button" className="font-medium hover:text-brand" onClick={() => go(entry)}>{LABELS[entry]}</button>
                      <span className="block text-ink-muted">{found ?? "Done"}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[12.5px] text-ink-subtle">Saved as <span className="font-mono">{slugify(draft.slug || draft.title) || "..."}</span>, filed under {topics.find((topic) => topic.id === draft.topicId)?.name ?? "no topic"}, {draft.difficulty}.</p>
          </Panel>
          {coding && checked && <Result checked={checked} fresh={fresh} />}
        </div>
      )}

      {(problem || message) && (
        <p role="alert" className="flex items-start gap-2 rounded-[var(--radius-control)] border border-danger/30 bg-danger-soft px-3 py-2 text-[13.5px] text-danger">
          <WarningCircle className="mt-0.5 size-4 shrink-0" />
          {problem ?? message}
        </p>
      )}

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-full border border-line bg-surface/90 px-4 py-2.5 shadow-[var(--shadow-panel)] backdrop-blur">
        <Button variant="ghost" onClick={() => go(order[at - 1]!)} disabled={at === 0}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        {step === "verify" ? (
          <div className="flex flex-wrap items-center gap-2">
            {coding && (
              <p className="mr-1 hidden items-center gap-2 text-[13px] text-ink-muted md:flex">
                {ready ? <><CheckCircle className="size-4 text-success" weight="fill" /> Verified. Ready to save.</> : checked && !fresh ? <><WarningCircle className="size-4 text-warning" /> Changed after verifying. Verify again.</> : <><ShieldCheck className="size-4" /> Verify before saving.</>}
              </p>
            )}
            {id && canDelete && (
              <Button variant="danger" onClick={() => confirm("Delete this question?") && deleteQuestion(id)}>
                <Trash className="size-3.5" /> Delete
              </Button>
            )}
            {coding && (
              <Button variant="secondary" onClick={verify} disabled={verifying || saving}>
                {verifying ? <CircleNotch className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                {verifying ? "Judging..." : "Verify with judge"}
              </Button>
            )}
            <Button onClick={save} disabled={!ready || saving}>
              {saving ? "Saving..." : id ? "Save changes" : "Save question"}
            </Button>
          </div>
        ) : (
          <Button onClick={forward}>
            Next <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function Result({ checked, fresh }: { checked: Checked; fresh: boolean }) {
  const { result } = checked;
  return (
    <Panel className={fresh ? "" : "opacity-60"} aria-label="Judge result">
      <div className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
        {result.passed ? <CheckCircle className="size-5 text-success" weight="fill" /> : <XCircle className="size-5 text-danger" weight="fill" />}
        {result.passed ? "Every model solution passed every test" : "The judge found problems"}
      </div>
      <div className="space-y-3">
        {result.solutions.map((solution) => (
          <div key={solution.language} className="rounded-[var(--radius-control)] border border-line p-3 text-[13px]">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-medium">{LANGUAGES[solution.language].label}</span>
              <span className={solution.passed ? "text-success" : "text-danger"}>{solution.passed ? "passed" : "failed"}</span>
            </div>
            {solution.compileError ? (
              <pre className="overflow-auto rounded bg-danger-soft p-2 font-mono text-[12px] text-danger">{solution.compileError}</pre>
            ) : (
              <ul className="grid gap-1 sm:grid-cols-2">
                {solution.tests.map((entry) => (
                  <li key={entry.index} className="flex items-center justify-between gap-2 rounded bg-surface-2 px-2 py-1">
                    <span className="font-mono">Test {entry.index + 1}</span>
                    <span className={entry.passed ? "text-success" : "text-danger"}>
                      {entry.passed ? "passed" : entry.status === "ok" ? "wrong answer" : entry.status.replace("_", " ")}
                      {entry.timeMs !== null && <span className="ml-2 text-ink-subtle">{entry.timeMs} ms</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {solution.tests.filter((entry) => !entry.passed && entry.status === "ok").slice(0, 2).map((entry) => (
              <p key={entry.index} className="mt-2 font-mono text-[12px] text-ink-muted">
                Test {entry.index + 1} printed: <span className="text-danger">{entry.actual || "(nothing)"}</span>
              </p>
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}
