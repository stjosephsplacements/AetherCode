"use client";

import { ArrowLeft, Check, ChevronDown, CircleCheck, CircleX, LoaderCircle, Lock, Play, Upload } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Checkbox, Tabs } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { useEditorSettings } from "@/components/exam/editor-settings";
import { EditorSettingsMenu } from "@/components/exam/editor-settings-menu";
import { RunConsole, type RunState } from "@/components/exam/run-console";
import type { CodeRun, PracticeQuestion, PracticeRun } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { cn, formatDateTime, languageName } from "@/lib/utils";

const CodeEditor = dynamic(() => import("@/components/exam/code-editor").then((module) => module.CodeEditor), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse bg-hover/40" />,
});

const DIFFICULTY_TONE = { easy: "success", medium: "warning", hard: "danger" } as const;
const VERDICTS: Record<string, string> = {
  accepted: "Accepted",
  wrong_answer: "Wrong answer",
  time_limit_exceeded: "Time limit exceeded",
  memory_limit_exceeded: "Memory limit exceeded",
  runtime_error: "Runtime error",
  compile_error: "Compilation error",
  internal_error: "Judge error",
};

type ConsoleTab = "results" | "input" | "submissions";
type SubmitState = { kind: "idle" } | { kind: "judging" } | { kind: "done"; run: PracticeRun } | { kind: "error"; message: string };

/** A practice run as the exam's run console reads it. */
function asCodeRun(run: PracticeRun): CodeRun {
  return {
    id: run.id,
    exam_item_id: run.question_id,
    language_id: run.language,
    lifecycle_state: run.lifecycle_state,
    verdict: run.verdict,
    created_at: run.requested_at,
    completed_at: run.completed_at,
    units: run.units.map((unit) => ({
      unit_number: unit.unit_number,
      verdict: unit.verdict,
      stdin: unit.stdin ?? null,
      expected_output: unit.expected_output ?? null,
      stdout: unit.stdout ?? null,
      stderr: unit.stderr ?? null,
      compile_output: unit.compile_output ?? null,
      execution_time_ms: unit.time_ms ?? null,
      memory_kib: unit.memory_kib ?? null,
    })),
  };
}

/** Drafts live in this browser only, one per problem and language. */
function draftKey(questionId: string, language: string) {
  return `aether:practice:${questionId}:${language}`;
}
function readDraft(questionId: string, language: string): string {
  try {
    return localStorage.getItem(draftKey(questionId, language)) ?? "";
  } catch {
    return "";
  }
}

export function PracticeWorkspace({ tenantId, question }: { tenantId: string; question: PracticeQuestion }) {
  const base = `/question-bank/v1/tenants/${tenantId}/practice`;
  const settings = useEditorSettings();
  const [language, setLanguage] = useState(question.languages[0] ?? "");
  const [source, setSource] = useState("");
  const [input, setInput] = useState(question.samples[0]?.input ?? "");
  const [useCustomInput, setUseCustomInput] = useState(false);
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>("results");
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });
  const [history, setHistory] = useState<PracticeRun[] | undefined>(undefined);

  // Code opened from a submission replaces the draft of its language once.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    setSource(opened.current ?? readDraft(question.question_id, language));
    opened.current = null;
  }, [question.question_id, language]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(question.question_id, language), source);
      } catch {
        // Private windows may refuse storage; the editor still works.
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [question.question_id, language, source]);

  const fetchHistory = useCallback(
    () =>
      api<PracticeRun[]>(`${base}/questions/${question.question_id}/submissions`).then(
        (runs) => runs.filter((entry) => entry.mode === "submit"),
        () => [],
      ),
    [base, question.question_id],
  );
  const loadHistory = useCallback(() => fetchHistory().then(setHistory), [fetchHistory]);
  useEffect(() => {
    let cancelled = false;
    void fetchHistory().then((runs) => {
      if (!cancelled) setHistory(runs);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchHistory]);

  /** Starts a job and polls it until Judge finishes. */
  const execute = useCallback(
    async (mode: "run" | "submit", custom: boolean): Promise<PracticeRun> => {
      const body = custom ? { language, source, mode, input } : { language, source, mode };
      const { id } = await api<{ id: string }>(`${base}/questions/${question.question_id}/submissions`, { method: "POST", body });
      for (let poll = 0; poll < 120; poll++) {
        await new Promise((resolve) => setTimeout(resolve, poll < 5 ? 700 : 1500));
        const result = await api<PracticeRun>(`${base}/submissions/${id}`);
        if (result.lifecycle_state !== "queued") return result;
      }
      throw new Error("The judge is busy. Try again in a moment.");
    },
    [base, question.question_id, language, source, input],
  );

  const runCode = useCallback(async () => {
    if (!source.trim()) return void toast("Write some code first.");
    const custom = useCustomInput;
    setConsoleTab(custom ? "input" : "results");
    setRun({ kind: "running", custom });
    try {
      setRun({ kind: "done", run: asCodeRun(await execute("run", custom)), custom });
    } catch (error) {
      setRun({ kind: "error", message: error instanceof Error ? error.message : "The run failed." });
    }
  }, [source, useCustomInput, execute]);

  const submitCode = useCallback(async () => {
    if (!source.trim()) return void toast("Write some code first.");
    setConsoleTab("submissions");
    setSubmit({ kind: "judging" });
    try {
      const result = await execute("submit", false);
      setSubmit({ kind: "done", run: result });
      if (result.verdict === "accepted") toast.success("Accepted. Problem solved.");
    } catch (error) {
      setSubmit({ kind: "error", message: error instanceof Error ? error.message : "The submission failed." });
    }
    void loadHistory();
  }, [source, execute, loadHistory]);

  async function openSubmission(id: string) {
    const full = await api<PracticeRun>(`${base}/submissions/${id}`).catch(() => null);
    if (!full?.source) return void toast.error("That submission could not be opened.");
    if (full.language === language) setSource(full.source);
    else {
      opened.current = full.source;
      setLanguage(full.language);
    }
    toast("Loaded your submitted code into the editor.");
  }

  const solved = history?.some((entry) => entry.verdict === "accepted") ?? false;

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Link href="/student/practice" className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" strokeWidth={1.75} />
          Practice
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{question.title}</h1>
        {solved && <Badge tone="success">Solved</Badge>}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row">
        <section aria-label="Problem" className="flex min-h-0 flex-col lg:w-[40%] lg:max-w-[640px]">
          <article className="min-h-0 flex-1 overflow-y-auto px-3 pb-8 pt-3 lg:px-4">
            <h2 className="display text-[1.75rem] text-ink">{question.title}</h2>
            <p className="mt-3 flex flex-wrap gap-2 text-[13px] text-ink-muted">
              <Badge tone={DIFFICULTY_TONE[question.difficulty]}>{question.difficulty}</Badge>
              <span className="rounded-full bg-hover px-2.5 py-0.5">Time limit {question.time_limit_ms / 1000} s</span>
              <span className="rounded-full bg-hover px-2.5 py-0.5">Memory {Math.round(question.memory_limit_kib / 1024)} MB</span>
              {question.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-hover px-2.5 py-0.5">
                  {tag}
                </span>
              ))}
            </p>
            <Markdown className="mt-6">{question.prompt_markdown}</Markdown>
            {question.samples.map((sample, index) => (
              <div key={index} className="mt-6">
                <p className="mb-2 text-[13px] font-medium text-ink">Sample {index + 1}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Sample label="Input" value={sample.input} />
                  <Sample label="Output" value={sample.expected_output} />
                </div>
              </div>
            ))}
          </article>
        </section>

        <section
          aria-label="Your code"
          className="flex min-h-[460px] flex-1 flex-col overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface shadow-[var(--shadow-panel)]"
        >
          <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2.5">
            <label className="relative">
              <span className="sr-only">Language</span>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                className="h-8 appearance-none rounded-[var(--radius-control)] bg-transparent pl-2.5 pr-8 text-[13px] font-medium text-ink outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand"
              >
                {question.languages.map((key) => (
                  <option key={key} value={key}>
                    {languageName(key)}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted" strokeWidth={2} />
            </label>
            <div className="ml-auto">
              <EditorSettingsMenu />
            </div>
          </div>

          <div className="min-h-0 flex-1">
            <CodeEditor
              path={`${question.question_id}-${language}`}
              language={language}
              value={source}
              onChange={setSource}
              readOnly={false}
              settings={settings}
              onRun={runCode}
              onSubmit={submitCode}
            />
          </div>

          <Tabs.Root value={consoleTab} onValueChange={(value) => setConsoleTab(value as ConsoleTab)} className="flex h-[40%] min-h-[220px] shrink-0 flex-col border-t bg-canvas/40">
            <Tabs.List aria-label="Console" className="flex h-10 shrink-0 items-center gap-0.5 px-2">
              <TabTrigger value="results" active={consoleTab === "results"}>
                Test results
              </TabTrigger>
              {useCustomInput && (
                <TabTrigger value="input" active={consoleTab === "input"}>
                  Custom input
                </TabTrigger>
              )}
              <TabTrigger value="submissions" active={consoleTab === "submissions"}>
                Submissions
                {history && history.length > 0 && <span className="ml-1.5 text-ink-subtle">{history.length}</span>}
              </TabTrigger>
            </Tabs.List>
            <Tabs.Content value="results" className="min-h-0 flex-1 outline-none">
              <RunConsole key={run.kind === "done" ? run.run.id : run.kind} state={run.kind === "done" && run.custom ? { kind: "idle" } : run} />
            </Tabs.Content>
            <Tabs.Content value="input" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3 outline-none lg:flex-row">
              <label className="flex min-h-[120px] flex-1 flex-col">
                <span className="mb-1.5 text-xs text-ink-muted">Input (stdin)</span>
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  spellCheck={false}
                  placeholder="Type the input your program reads"
                  className="min-h-0 flex-1 resize-none rounded-[var(--radius-control)] border border-line bg-surface p-3 font-mono text-xs leading-relaxed text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15"
                />
              </label>
              <div className="min-h-[120px] flex-1">
                <RunConsole
                  key={"custom" + (run.kind === "done" ? run.run.id : run.kind)}
                  state={run.kind === "done" && !run.custom ? { kind: "idle" } : run}
                  idleText="Press Run code to run your program with this input."
                />
              </div>
            </Tabs.Content>
            <Tabs.Content value="submissions" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 outline-none">
              <SubmitResult state={submit} />
              <History runs={history} onOpen={openSubmission} />
            </Tabs.Content>
          </Tabs.Root>

          <div className="flex h-14 shrink-0 items-center gap-3 border-t px-3">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
              <Checkbox.Root
                checked={useCustomInput}
                onCheckedChange={(checked) => {
                  const on = checked === true;
                  setUseCustomInput(on);
                  setConsoleTab(on ? "input" : "results");
                }}
                className="grid size-4 place-items-center rounded-[4px] border border-line-strong bg-surface outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand data-[state=checked]:border-brand data-[state=checked]:bg-brand"
              >
                <Checkbox.Indicator>
                  <Check className="size-3 text-brand-ink" strokeWidth={3} />
                </Checkbox.Indicator>
              </Checkbox.Root>
              Test against custom input
            </label>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="secondary" onClick={runCode} disabled={run.kind === "running"} title="Ctrl + Enter">
                {run.kind === "running" ? <LoaderCircle className="animate-spin" /> : <Play />}
                Run code
              </Button>
              <Button onClick={submitCode} disabled={submit.kind === "judging"} title="Ctrl + Shift + Enter">
                {submit.kind === "judging" ? <LoaderCircle className="animate-spin" /> : <Upload />}
                Submit
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Sample({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs text-ink-muted">{label}</p>
      <pre className="overflow-auto whitespace-pre-wrap rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-ink">
        {value || <span className="text-ink-subtle">(empty)</span>}
      </pre>
    </div>
  );
}

function TabTrigger({ value, active, children }: { value: ConsoleTab; active: boolean; children: React.ReactNode }) {
  return (
    <Tabs.Trigger
      value={value}
      className={cn(
        "flex h-8 items-center rounded-[var(--radius-control)] px-3 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand",
        active ? "bg-surface font-medium text-ink shadow-[var(--shadow-hairline)] ring-1 ring-line" : "text-ink-muted hover:bg-hover hover:text-ink",
      )}
    >
      {children}
    </Tabs.Trigger>
  );
}

/** The latest submission's verdict on every test; hidden tests show pass or fail only. */
function SubmitResult({ state }: { state: SubmitState }) {
  if (state.kind === "idle") return null;
  if (state.kind === "judging") {
    return (
      <p className="flex items-center gap-2 py-3 text-[13px] text-ink-muted">
        <LoaderCircle className="size-4 animate-spin" />
        Judging your submission against every test
      </p>
    );
  }
  if (state.kind === "error") return <p className="py-3 text-[13px] text-danger">{state.message}</p>;
  const { run } = state;
  const accepted = run.verdict === "accepted";
  const compile = run.units.find((unit) => unit.compile_output)?.compile_output;
  return (
    <div className="mb-3 rounded-[var(--radius-control)] border border-line bg-surface px-3.5 py-3">
      <p className={cn("text-[15px] font-medium", accepted ? "text-success" : "text-danger")}>
        {run.lifecycle_state === "failed" ? "The judge could not evaluate this. Submit again." : (VERDICTS[run.verdict ?? ""] ?? run.verdict)}
        {run.total_units > 0 && (
          <span className="ml-2 text-[13px] font-normal text-ink-muted">
            {run.passed_units} of {run.total_units} tests passed
          </span>
        )}
      </p>
      {compile && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-danger-soft p-2 font-mono text-xs text-danger">{compile}</pre>}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {[...run.units]
          .sort((a, b) => a.unit_number - b.unit_number)
          .map((unit, index) => (
            <span
              key={unit.unit_number}
              title={VERDICTS[unit.verdict] ?? unit.verdict}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs",
                unit.verdict === "accepted" ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
              )}
            >
              {unit.verdict === "accepted" ? <CircleCheck className="size-3" strokeWidth={2} /> : <CircleX className="size-3" strokeWidth={2} />}
              Test {index + 1}
              {unit.time_ms !== undefined && <span className="opacity-70">{unit.time_ms} ms</span>}
            </span>
          ))}
      </div>
    </div>
  );
}

function History({ runs, onOpen }: { runs: PracticeRun[] | undefined; onOpen: (id: string) => void }) {
  if (!runs) return <p className="py-3 text-[13px] text-ink-muted">Loading your submissions</p>;
  if (runs.length === 0) {
    return (
      <p className="flex items-center gap-1.5 py-3 text-[13px] text-ink-muted">
        <Lock className="size-3.5" strokeWidth={2} />
        Submit to check your code against every test, hidden ones included.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line rounded-[var(--radius-control)] border border-line bg-surface">
      {runs.map((entry) => (
        <li key={entry.id} className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
          {entry.lifecycle_state === "queued" ? (
            <LoaderCircle className="size-4 animate-spin text-ink-muted" />
          ) : entry.verdict === "accepted" ? (
            <CircleCheck className="size-4 text-success" strokeWidth={2} />
          ) : (
            <CircleX className="size-4 text-danger" strokeWidth={2} />
          )}
          <span className={cn("font-medium", entry.verdict === "accepted" ? "text-success" : "text-ink")}>
            {entry.lifecycle_state === "queued" ? "Judging" : (VERDICTS[entry.verdict ?? ""] ?? entry.verdict)}
          </span>
          {entry.total_units > 0 && (
            <span className="text-ink-muted">
              {entry.passed_units}/{entry.total_units}
            </span>
          )}
          <span className="hidden text-ink-subtle sm:inline">
            {languageName(entry.language)}, {formatDateTime(entry.requested_at)}
          </span>
          <button type="button" onClick={() => onOpen(entry.id)} className="ml-auto text-brand hover:underline">
            Open code
          </button>
        </li>
      ))}
    </ul>
  );
}
