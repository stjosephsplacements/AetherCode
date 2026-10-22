"use client";

import { Check, ChevronDown, Clock3, CloudOff, LoaderCircle, Maximize2, Megaphone, Minimize2, Play, RotateCcw, ShieldCheck, Upload, X } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AlertDialog, Checkbox, Tabs } from "radix-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import type { Attempt, CodeRun, ItemSubmission, Paper } from "@/lib/api-types";
import { APIError, api } from "@/lib/client/api";
import { formatCountdown, useNow } from "@/lib/client/use-now";
import { cn, formatTime, languageName } from "@/lib/utils";
import { useEditorSettings } from "./editor-settings";
import { EditorSettingsMenu } from "./editor-settings-menu";
import { EndTestDialog } from "./end-test-dialog";
import { type QuestionStatus, QuestionRail, formatScore } from "./question-rail";
import { RunConsole, type RunState, runSummary } from "./run-console";
import { ChoicePane } from "./choice-pane";
import { SubmissionsPanel } from "./submissions-panel";
import { type SaveState, useAnswers } from "./use-answers";
import { useIntegrity } from "./use-integrity";
import { useLiveState } from "./use-live-state";
import { bestScore, isJudging, useSubmissions } from "./use-submissions";

const CodeEditor = dynamic(() => import("./code-editor").then((module) => module.CodeEditor), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse bg-hover/40" />,
});

type Loaded = { attempt: Attempt; paper: Paper };
type ConsoleTab = "results" | "input" | "submissions";

/** Loads the attempt and its paper from the browser, so Safe Exam Browser signs the requests. */
export function ExamScreen({ tenantId, attemptId }: { tenantId: string; attemptId: string }) {
  const router = useRouter();
  const attemptPath = `/submission/v1/tenants/${tenantId}/attempts/${attemptId}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<APIError | Error | null>(null);

  useEffect(() => {
    Promise.all([api<Attempt>(attemptPath), api<Paper>(`${attemptPath}/paper`)])
      .then(([attempt, paper]) => {
        if (attempt.lifecycle_state !== "active" && attempt.lifecycle_state !== "created") {
          router.replace(`/student/results/${attemptId}`);
          return;
        }
        setLoaded({ attempt, paper });
      })
      .catch((error: Error) => setFailure(error));
  }, [attemptPath, attemptId, router]);

  if (failure) {
    const seb = failure instanceof APIError && failure.code === "seb_required";
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-center">
        <div className="max-w-sm animate-enter">
          {seb && <ShieldCheck className="mx-auto size-7 text-brand" strokeWidth={1.5} />}
          <h1 className="display mt-4 text-[1.9rem] text-ink">{seb ? "Open this exam in Safe Exam Browser" : "The exam could not load"}</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">{failure.message}</p>
          {!seb && (
            <Button className="mt-6" onClick={() => location.reload()}>
              Try again
            </Button>
          )}
        </div>
      </main>
    );
  }
  if (!loaded) return <ExamSkeleton />;
  return <ExamWorkspace attemptPath={attemptPath} attemptId={attemptId} {...loaded} />;
}

function ExamSkeleton() {
  return (
    <div className="flex h-dvh flex-col" aria-busy="true" aria-label="Loading your exam">
      <div className="h-14 border-b" />
      <div className="flex flex-1 gap-3 p-3">
        <div className="hidden w-14 space-y-2 lg:block">
          {[0, 1, 2].map((index) => (
            <div key={index} className="size-10 animate-pulse rounded-[var(--radius-control)] bg-hover" />
          ))}
        </div>
        <div className="hidden flex-[0.8] space-y-4 px-5 py-6 lg:block">
          <div className="h-3 w-24 animate-pulse rounded bg-hover" />
          <div className="h-7 w-2/3 animate-pulse rounded bg-hover" />
          <div className="h-3 w-full animate-pulse rounded bg-hover" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-hover" />
        </div>
        <div className="flex-1 animate-pulse rounded-[var(--radius-surface)] bg-hover/60" />
      </div>
    </div>
  );
}

function ExamWorkspace({ attemptPath, attemptId, attempt, paper }: Loaded & { attemptPath: string; attemptId: string }) {
  const router = useRouter();
  const [items] = useState(() => [...paper.items].sort((a, b) => a.position - b.position));
  const itemIds = useMemo(() => items.map((item) => item.exam_item_id), [items]);
  const answers = useAnswers(attemptPath, items, attempt.version);
  const submissions = useSubmissions(attemptPath, itemIds);
  const settings = useEditorSettings();
  const [currentId, setCurrentId] = useState(items[0]!.exam_item_id);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [customRuns, setCustomRuns] = useState<Record<string, RunState>>({});
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  // Multiple-choice selections, saved one change at a time (ADR-0035).
  const [selections, setSelections] = useState<Record<string, number[]>>(() =>
    Object.fromEntries(items.filter((candidate) => candidate.kind === "mcq").map((candidate) => [candidate.exam_item_id, candidate.latest_choice ?? []])),
  );
  const [useCustomInput, setUseCustomInput] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>("results");
  const [statementOpen, setStatementOpen] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const finished = useRef(false);
  const warned = useRef(new Set<number>());
  const live = useLiveState(attemptPath, attempt.submission_deadline);
  const now = useNow();
  const remaining = now === null ? null : Date.parse(live.deadline) - now;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const latestNote = live.announcements[0];

  const index = items.findIndex((candidate) => candidate.exam_item_id === currentId);
  const item = items[index]!;
  const draft = answers.draft(currentId);
  const run = runs[currentId] ?? { kind: "idle" };
  const customRun = customRuns[currentId] ?? { kind: "idle" };
  const activeRun = useCustomInput ? customRun : run;
  const readOnly = answers.saveState === "closed";
  const integrity = useIntegrity(attemptPath, live.integrity.requireFullscreen, !readOnly && !ending);
  const itemSubmissions = submissions.byItem[currentId];

  const statuses = useMemo(() => {
    const result: Record<string, QuestionStatus> = {};
    for (const candidate of items) {
      if (candidate.kind === "mcq") {
        result[candidate.exam_item_id] = (selections[candidate.exam_item_id]?.length ?? 0) > 0 ? { kind: "saved" } : { kind: "empty" };
        continue;
      }
      const list: ItemSubmission[] | undefined = submissions.byItem[candidate.exam_item_id];
      const best = bestScore(list);
      if (isJudging(list)) result[candidate.exam_item_id] = { kind: "judging", best, maximum: Number(candidate.maximum_score) };
      else if (best !== null) result[candidate.exam_item_id] = { kind: "submitted", best, maximum: Number(candidate.maximum_score) };
      else if (answers.isAnswered(candidate.exam_item_id)) result[candidate.exam_item_id] = { kind: "saved" };
      else result[candidate.exam_item_id] = { kind: "empty" };
    }
    return result;
    // answers.draft changes are reflected through the answer book's revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, submissions.byItem, answers, draft.source, selections]);

  const finish = useCallback(() => {
    finished.current = true;
    router.replace(`/student/results/${attemptId}`);
  }, [router, attemptId]);

  // Time warnings, like HackerRank: at 10, 5 and 1 minutes left.
  useEffect(() => {
    if (remaining === null) return;
    for (const minutes of [10, 5, 1]) {
      if (remaining <= minutes * 60_000 && remaining > (minutes - 1) * 60_000 && !warned.current.has(minutes)) {
        warned.current.add(minutes);
        toast(`${minutes} minute${minutes === 1 ? "" : "s"} left. Submit your answers.`);
      }
    }
  }, [remaining]);

  // Time-up: hand over the latest code (the server accepts saves for 15 s
  // past the deadline) and leave; the server evaluates the saved answers.
  useEffect(() => {
    if (remaining === null || remaining > 0 || finished.current) return;
    finished.current = true;
    toast("Time is up. Your saved code is being evaluated.");
    void answers.flush().finally(finish);
  }, [remaining, answers, finish]);

  function selectQuestion(itemId: string) {
    void answers.flush();
    setCurrentId(itemId);
  }

  const runCode = useCallback(async () => {
    const itemId = currentId;
    const { language, source } = answers.draft(itemId);
    if (!source.trim()) return void toast("Write some code first.");
    const custom = useCustomInput;
    const setRun = custom ? setCustomRuns : setRuns;
    setConsoleOpen(true);
    setConsoleTab(custom ? "input" : "results");
    setRun((all) => ({ ...all, [itemId]: { kind: "running", custom } }));
    void answers.flush();
    try {
      const body = custom ? { language, source, input: customInputs[itemId] ?? "" } : { language, source };
      const started = await api<CodeRun>(`${attemptPath}/items/${itemId}/runs`, { method: "POST", body });
      for (let poll = 0; poll < 90; poll++) {
        await new Promise((resolve) => setTimeout(resolve, poll < 5 ? 700 : 1500));
        const result = await api<CodeRun>(`${attemptPath}/runs/${started.id}`);
        if (result.lifecycle_state === "completed" || result.lifecycle_state === "failed" || result.lifecycle_state === "cancelled") {
          setRun((all) => ({ ...all, [itemId]: { kind: "done", run: result, custom } }));
          return;
        }
      }
      setRun((all) => ({ ...all, [itemId]: { kind: "error", message: "The judge is busy. Try running again in a moment." } }));
    } catch (error) {
      setRun((all) => ({ ...all, [itemId]: { kind: "error", message: error instanceof Error ? error.message : "The run failed." } }));
    }
  }, [currentId, answers, useCustomInput, customInputs, attemptPath]);

  const submitCode = useCallback(async () => {
    const itemId = currentId;
    if (!answers.draft(itemId).source.trim()) return void toast("Write some code first.");
    setSubmitting(itemId);
    setConsoleOpen(true);
    setConsoleTab("submissions");
    try {
      // The server evaluates the latest saved code, so save it first.
      await answers.flush();
      if (answers.saveState === "error") throw new Error("Your code could not be saved, so it was not submitted.");
      await api(`${attemptPath}/items/${itemId}/submissions`, { method: "POST" });
      await submissions.refresh([itemId]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Your code could not be submitted.");
    } finally {
      setSubmitting(null);
    }
  }, [currentId, answers, attemptPath, submissions]);

  async function endTest() {
    setEnding(true);
    try {
      await answers.flush();
      await api(`${attemptPath}/submit`, { method: "POST", body: { expected_attempt_version: answers.version } });
      finish();
    } catch (error) {
      const attemptNow = await api<Attempt>(attemptPath).catch(() => null);
      if (attemptNow && attemptNow.lifecycle_state !== "active") return finish();
      setEnding(false);
      toast.error(error instanceof Error ? error.message : "The test could not be ended. Try again.");
    }
  }

  function resetCode() {
    answers.update(currentId, { source: "" });
    toast("Code cleared.");
  }

  const summary = runSummary(activeRun);
  const minutesLeft = remaining === null ? null : remaining / 60_000;

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Image src="/logo.png" alt="AetherCode" width={22} height={22} />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{paper.title}</h1>
        <SaveIndicator state={answers.saveState} error={answers.saveError} />
        <span
          role="timer"
          aria-label="Time remaining"
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[13px] font-medium tabular-nums transition-colors",
            minutesLeft !== null && minutesLeft <= 5
              ? "bg-danger-soft text-danger"
              : minutesLeft !== null && minutesLeft <= 10
                ? "bg-warning-soft text-warning"
                : "bg-hover text-ink",
          )}
        >
          <Clock3 className="size-3.5" strokeWidth={2} />
          {remaining === null ? "--:--" : formatCountdown(remaining)}
        </span>
        <EndTestDialog items={items} statuses={statuses} ending={ending} onEnd={endTest} />
      </header>

      {integrity.needsFullscreen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-40 grid place-items-center bg-canvas px-4">
          <div className="max-w-md text-center">
            <h2 className="display text-[2rem] text-ink">Fullscreen required</h2>
            <p className="mt-3 text-[15px] text-ink-muted">
              This exam must be taken in fullscreen. Leaving fullscreen is recorded. Your timer keeps running:{" "}
              <strong className="font-mono text-ink">{remaining === null ? "--:--" : formatCountdown(remaining)}</strong> left.
            </p>
            <Button className="mt-8" size="lg" onClick={integrity.enterFullscreen}>
              <Maximize2 />
              Enter fullscreen
            </Button>
          </div>
        </div>
      )}

      {latestNote && latestNote.id !== dismissed && (
        <div role="status" className="flex items-start gap-3 border-b bg-brand-soft px-4 py-2 text-sm text-brand-soft-ink">
          <Megaphone className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <p className="min-w-0 flex-1 whitespace-pre-wrap">
            <span className="font-medium">Announcement, {formatTime(latestNote.created_at)}: </span>
            {latestNote.body}
          </p>
          <button type="button" onClick={() => setDismissed(latestNote.id)} aria-label="Dismiss announcement" className="shrink-0 rounded p-0.5 hover:bg-brand/10">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      )}

      {readOnly && (
        <p role="alert" className="bg-warning-soft px-4 py-2 text-center text-sm text-warning">
          This exam has ended. Changes are no longer saved.
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row">
        <QuestionRail items={items} currentId={currentId} statuses={statuses} onSelect={selectQuestion} />

        {statementOpen && (
          <section aria-label="Question" className="flex min-h-0 flex-col lg:w-[38%] lg:max-w-[600px]">
            <article className="min-h-0 flex-1 overflow-y-auto px-3 pb-8 pt-3 lg:px-4">
              <p className="text-[13px] text-ink-muted">
                Question {index + 1} of {items.length}
              </p>
              <h2 className="display mt-1.5 text-[1.75rem] text-ink">{item.title}</h2>
              <p className="mt-3 flex flex-wrap gap-2 text-[13px] text-ink-muted">
                <span className="rounded-full bg-brand-soft px-2.5 py-0.5 font-medium text-brand-soft-ink">
                  {formatScore(Number(item.maximum_score))} marks
                </span>
                <BestScore status={statuses[currentId]} />
                {item.time_limit_ms > 0 && <span className="rounded-full bg-hover px-2.5 py-0.5">Time limit {item.time_limit_ms / 1000} s</span>}
                {item.memory_limit_kib > 0 && <span className="rounded-full bg-hover px-2.5 py-0.5">Memory {Math.round(item.memory_limit_kib / 1024)} MB</span>}
              </p>
              {item.prompt_markdown ? (
                <Markdown className="mt-6">{item.prompt_markdown}</Markdown>
              ) : (
                <p className="mt-6 text-sm text-ink-muted">This question has no statement on screen. Ask your invigilator for it.</p>
              )}
            </article>
          </section>
        )}

        {item.kind === "mcq" ? (
          <ChoicePane
            key={currentId}
            attemptPath={attemptPath}
            item={item}
            selected={selections[currentId] ?? []}
            readOnly={readOnly || remaining === 0}
            onSaved={(selected) => setSelections((all) => ({ ...all, [currentId]: selected }))}
          />
        ) : (
        <section
          aria-label="Your code"
          className="flex min-h-[460px] flex-1 flex-col overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface shadow-[var(--shadow-panel)]"
        >
          <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2.5">
            <label className="relative">
              <span className="sr-only">Language</span>
              <select
                value={draft.language}
                onChange={(event) => answers.update(currentId, { language: event.target.value })}
                disabled={readOnly}
                className="h-8 appearance-none rounded-[var(--radius-control)] bg-transparent pl-2.5 pr-8 text-[13px] font-medium text-ink outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand"
              >
                {item.supported_languages.map((language) => (
                  <option key={language} value={language}>
                    {languageName(language)}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted" strokeWidth={2} />
            </label>
            <div className="ml-auto flex items-center gap-0.5">
              <ResetCode disabled={readOnly || !draft.source} onReset={resetCode} />
              <EditorSettingsMenu />
              <IconButton
                label={statementOpen ? "Expand editor" : "Show question"}
                onClick={() => setStatementOpen((open) => !open)}
                className="hidden lg:grid"
              >
                {statementOpen ? <Maximize2 className="size-4" strokeWidth={1.75} /> : <Minimize2 className="size-4" strokeWidth={1.75} />}
              </IconButton>
            </div>
          </div>

          <div className="min-h-0 flex-1">
            <CodeEditor
              path={currentId}
              language={draft.language}
              value={draft.source}
              onChange={(source) => answers.update(currentId, { source })}
              readOnly={readOnly}
              settings={settings}
              onRun={runCode}
              onSubmit={submitCode}
              guardPaste={live.integrity.blockExternalPaste}
              onBlockedPaste={integrity.blockedPaste}
            />
          </div>

          <Tabs.Root
            value={consoleTab}
            onValueChange={(value) => {
              setConsoleTab(value as ConsoleTab);
              setConsoleOpen(true);
            }}
            className={cn("flex shrink-0 flex-col border-t bg-canvas/40", consoleOpen && "h-[42%] min-h-[220px]")}
          >
            <div className="flex h-10 shrink-0 items-center gap-1 px-2">
              <Tabs.List aria-label="Console" className="flex items-center gap-0.5">
                <ConsoleTabTrigger value="results" active={consoleOpen && consoleTab === "results"}>
                  Test results
                </ConsoleTabTrigger>
                {useCustomInput && (
                  <ConsoleTabTrigger value="input" active={consoleOpen && consoleTab === "input"}>
                    Custom input
                  </ConsoleTabTrigger>
                )}
                <ConsoleTabTrigger value="submissions" active={consoleOpen && consoleTab === "submissions"}>
                  Submissions
                  {itemSubmissions && itemSubmissions.length > 0 && <span className="ml-1.5 text-ink-subtle">{itemSubmissions.length}</span>}
                </ConsoleTabTrigger>
              </Tabs.List>
              {summary && (!consoleOpen || consoleTab !== "submissions") && (
                <span className={cn("ml-2 hidden truncate text-[13px] sm:inline", summary.tone)}>{summary.text}</span>
              )}
              <IconButton label={consoleOpen ? "Hide console" : "Show console"} onClick={() => setConsoleOpen((open) => !open)} className="ml-auto">
                <ChevronDown className={cn("size-4 transition-transform", consoleOpen && "rotate-180")} strokeWidth={1.75} />
              </IconButton>
            </div>
            {consoleOpen && (
              <>
                <Tabs.Content value="results" className="min-h-0 flex-1 outline-none">
                  <RunConsole key={currentId + (run.kind === "done" ? run.run.id : run.kind)} state={run} />
                </Tabs.Content>
                <Tabs.Content value="input" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3 outline-none lg:flex-row">
                  <label className="flex min-h-[120px] flex-1 flex-col">
                    <span className="mb-1.5 text-xs text-ink-muted">Input (stdin)</span>
                    <textarea
                      value={customInputs[currentId] ?? ""}
                      onChange={(event) => setCustomInputs((all) => ({ ...all, [currentId]: event.target.value }))}
                      spellCheck={false}
                      placeholder="Type the input your program reads"
                      className="min-h-0 flex-1 resize-none rounded-[var(--radius-control)] border border-line bg-surface p-3 font-mono text-xs leading-relaxed text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15"
                    />
                  </label>
                  <div className="min-h-[120px] flex-1">
                    <RunConsole key={currentId + "custom" + (customRun.kind === "done" ? customRun.run.id : customRun.kind)} state={customRun} idleText="Press Run code to run your program with this input." />
                  </div>
                </Tabs.Content>
                <Tabs.Content value="submissions" className="min-h-0 flex-1 outline-none">
                  <SubmissionsPanel items={itemSubmissions} />
                </Tabs.Content>
              </>
            )}
          </Tabs.Root>

          <div className="flex h-14 shrink-0 items-center gap-3 border-t px-3">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
              <Checkbox.Root
                checked={useCustomInput}
                onCheckedChange={(checked) => {
                  const on = checked === true;
                  setUseCustomInput(on);
                  if (on) {
                    setConsoleOpen(true);
                    setConsoleTab("input");
                  } else if (consoleTab === "input") setConsoleTab("results");
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
              <Button variant="secondary" onClick={runCode} disabled={activeRun.kind === "running" || readOnly} title="Ctrl + Enter">
                {activeRun.kind === "running" ? <LoaderCircle className="animate-spin" /> : <Play />}
                Run code
              </Button>
              <Button onClick={submitCode} disabled={submitting !== null || readOnly} title="Ctrl + Shift + Enter">
                {submitting === currentId ? <LoaderCircle className="animate-spin" /> : <Upload />}
                Submit code
              </Button>
            </div>
          </div>
        </section>
        )}
      </div>
    </div>
  );
}

function BestScore({ status }: { status: QuestionStatus | undefined }) {
  if (!status || (status.kind !== "submitted" && status.kind !== "judging") || status.best === null) return null;
  return (
    <span className="rounded-full bg-success-soft px-2.5 py-0.5 font-medium text-success">
      Best {formatScore(status.best)} of {formatScore(status.maximum)}
    </span>
  );
}

function ConsoleTabTrigger({ value, active, children }: { value: ConsoleTab; active: boolean; children: React.ReactNode }) {
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

function IconButton({ label, onClick, className, children }: { label: string; onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-8 place-items-center rounded-[var(--radius-control)] text-ink-muted outline-none transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand",
        className,
      )}
    >
      {children}
    </button>
  );
}

function ResetCode({ disabled, onReset }: { disabled: boolean; onReset: () => void }) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger
        disabled={disabled}
        aria-label="Reset code"
        title="Reset code"
        className="grid size-8 place-items-center rounded-[var(--radius-control)] text-ink-muted outline-none transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40"
      >
        <RotateCcw className="size-4" strokeWidth={1.75} />
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 animate-fade bg-[rgb(20_20_19/0.45)]" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-[380px] -translate-x-1/2 -translate-y-1/2 animate-enter rounded-[var(--radius-surface)] border border-line bg-surface p-6 shadow-[var(--shadow-overlay)]">
          <AlertDialog.Title className="display text-[1.4rem] text-ink">Clear your code?</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm leading-relaxed text-ink-muted">
            The editor for this question is emptied. Code you already submitted keeps its score.
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button onClick={onReset}>Clear code</Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function SaveIndicator({ state, error }: { state: SaveState; error: string | null }) {
  const view = {
    saved: { icon: <Check className="size-3.5" strokeWidth={2} />, label: "Saved", className: "text-ink-subtle" },
    saving: { icon: <LoaderCircle className="size-3.5 animate-spin" />, label: "Saving", className: "text-ink-subtle" },
    unsaved: { icon: null, label: "Editing", className: "text-ink-subtle" },
    error: { icon: <CloudOff className="size-3.5" strokeWidth={1.75} />, label: "Not saved", className: "text-danger" },
    closed: { icon: <CloudOff className="size-3.5" strokeWidth={1.75} />, label: "Ended", className: "text-warning" },
  }[state];
  return (
    <span className={cn("hidden items-center gap-1.5 text-[13px] sm:flex", view.className)} title={error ?? undefined} aria-live="polite">
      {view.icon}
      {view.label}
    </span>
  );
}

