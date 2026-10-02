"use client";

import CodeMirror from "@uiw/react-codemirror";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { python } from "@codemirror/lang-python";
import { indentUnit } from "@codemirror/language";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LANGUAGES, type LanguageId } from "@/lib/languages";
import { Button, Logo, cx } from "@/components/ui";
import { ResultPanel, type SubmissionView } from "./result-panel";

export interface IdeQuestion {
  id: string;
  title: string;
  statement: string;
  points: number;
  timeLimitMs: number;
  memoryLimitMb: number;
  samples: Array<{ input: string; expected: string }>;
  draft: { language: LanguageId; source: string } | null;
  best: { passed: number; total: number } | null;
}

interface Props {
  attemptId: string;
  title: string;
  studentName: string;
  username: string;
  languages: LanguageId[];
  deadline: string;
  serverNow: string;
  questions: IdeQuestion[];
}

const EXTENSIONS = {
  c: [cpp(), indentUnit.of("    ")],
  cpp: [cpp(), indentUnit.of("    ")],
  java: [java(), indentUnit.of("    ")],
  python: [python(), indentUnit.of("    ")],
};

const key = (questionId: string, language: LanguageId) => `${questionId}:${language}`;

function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function storageKey(attemptId: string) {
  return `exam-code:${attemptId}`;
}

export function ExamIde({ attemptId, title, studentName, username, languages, deadline, serverNow, questions }: Props) {
  const [active, setActive] = useState(0);
  const question = questions[active];

  // Code lives per question *and* language, so switching language never loses work.
  const [code, setCode] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const entry of questions) if (entry.draft) initial[key(entry.id, entry.draft.language)] = entry.draft.source;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(attemptId)) ?? "{}") as Record<string, string>;
      for (const [entryKey, value] of Object.entries(saved)) initial[entryKey] ??= value;
    } catch {
      // Local backup is optional.
    }
    return initial;
  });
  const [languageByQuestion, setLanguageByQuestion] = useState<Record<string, LanguageId>>(() =>
    Object.fromEntries(questions.map((entry) => [entry.id, entry.draft?.language ?? languages[0]])),
  );
  const language = languageByQuestion[question.id];
  const source = code[key(question.id, language)] ?? LANGUAGES[language].template;

  // Latest run and latest submit per question, keyed `${questionId}:${kind}`.
  const [results, setResults] = useState<Record<string, SubmissionView>>({});
  const [shownKind, setShownKind] = useState<Record<string, "run" | "submit">>({});
  const [best, setBest] = useState<Record<string, { passed: number; total: number } | null>>(() =>
    Object.fromEntries(questions.map((entry) => [entry.id, entry.best])),
  );
  const [runBusy, setRunBusy] = useState(false);
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"results" | "custom">("results");
  const [useCustom, setUseCustom] = useState(false);
  const [customInput, setCustomInput] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<"saved" | "saving" | "offline">("saved");
  const [focusWarning, setFocusWarning] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [split, setSplit] = useState(42);
  const [consoleHeight, setConsoleHeight] = useState(38);

  // ---- clock, anchored to server time ----
  const offset = useMemo(() => new Date(serverNow).getTime() - Date.now(), [serverNow]);
  const deadlineMs = useMemo(() => new Date(deadline).getTime(), [deadline]);
  const [remaining, setRemaining] = useState(() => deadlineMs - (Date.now() + offset));
  const finished = useRef(false);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    // Save the last edits (the server accepts drafts briefly after the deadline), then show the end screen.
    void flushRef.current().finally(() => window.location.reload());
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      const left = deadlineMs - (Date.now() + offset);
      setRemaining(left);
      if (left <= 0) finish();
    }, 500);
    return () => clearInterval(timer);
  }, [deadlineMs, offset, finish]);

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const response = await fetch(path, { ...init, headers: { "content-type": "application/json" } });
      if (response.status === 409) finish();
      if (response.status === 401) window.location.href = "/login";
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Request failed");
      return body;
    },
    [finish],
  );

  // ---- autosave: debounce to the server, mirror to localStorage immediately ----
  const dirty = useRef(new Map<string, { questionId: string; language: LanguageId; source: string }>());
  const flush = useCallback(async () => {
    const pending = [...dirty.current.values()];
    dirty.current.clear();
    if (pending.length === 0) return;
    setSaveState("saving");
    try {
      for (const draft of pending) await api(`/api/attempts/${attemptId}/drafts`, { method: "PUT", body: JSON.stringify(draft) });
      setSaveState("saved");
    } catch {
      for (const draft of pending) dirty.current.set(draft.questionId, draft);
      setSaveState("offline");
    }
  }, [api, attemptId]);
  flushRef.current = flush;
  useEffect(() => {
    const timer = setInterval(flush, 3000);
    return () => clearInterval(timer);
  }, [flush]);

  function edit(value: string) {
    setCode((current) => {
      const next = { ...current, [key(question.id, language)]: value };
      try {
        localStorage.setItem(storageKey(attemptId), JSON.stringify(next));
      } catch {
        // Local backup is optional.
      }
      return next;
    });
    dirty.current.set(question.id, { questionId: question.id, language, source: value });
    setSaveState("saving");
  }

  function changeLanguage(next: LanguageId) {
    setLanguageByQuestion((current) => ({ ...current, [question.id]: next }));
    const nextSource = code[key(question.id, next)] ?? LANGUAGES[next].template;
    dirty.current.set(question.id, { questionId: question.id, language: next, source: nextSource });
  }

  // ---- focus tracking ----
  useEffect(() => {
    let last = 0;
    const report = () => {
      if (finished.current || Date.now() - last < 3000) return;
      last = Date.now();
      setFocusWarning(true);
      void fetch(`/api/attempts/${attemptId}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "blur" }),
      });
    };
    const onVisibility = () => document.visibilityState === "hidden" && report();
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!finished.current) event.preventDefault();
    };
    window.addEventListener("blur", report);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("blur", report);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [attemptId]);

  // ---- run / submit ----
  // A run blocks only further runs; a submit grades in the background so the
  // student can keep working (its score is recorded either way).
  async function execute(kind: "run" | "submit") {
    const questionId = question.id;
    if (kind === "run" ? runBusy : submitting[questionId]) return;
    setError(null);
    setTab("results");
    setShownKind((current) => ({ ...current, [questionId]: kind }));
    const setBusy = (value: boolean) =>
      kind === "run" ? setRunBusy(value) : setSubmitting((current) => ({ ...current, [questionId]: value }));
    setBusy(true);
    const resultKey = `${questionId}:${kind}`;
    try {
      await flush();
      const { id } = await api(`/api/attempts/${attemptId}/submissions`, {
        method: "POST",
        body: JSON.stringify({
          questionId,
          language,
          source,
          kind,
          customInput: kind === "run" && useCustom ? (customInput[questionId] ?? "") : null,
        }),
      });
      setResults((current) => ({ ...current, [resultKey]: { id, kind, status: "queued" } }));
      for (let polls = 0; polls < 600; polls++) {
        await new Promise((resolve) => setTimeout(resolve, kind === "run" && polls < 10 ? 700 : 2000));
        const view = (await api(`/api/submissions/${id}`)) as SubmissionView;
        setResults((current) => ({ ...current, [resultKey]: { ...view, kind } }));
        if (view.status === "done" || view.status === "error") {
          if (kind === "submit" && view.total) {
            setBest((current) => {
              const previous = current[questionId];
              const better = !previous || (view.passed ?? 0) / view.total! > previous.passed / previous.total;
              return better ? { ...current, [questionId]: { passed: view.passed ?? 0, total: view.total! } } : current;
            });
          }
          break;
        }
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const ending = useRef(false);
  async function endExam() {
    if (ending.current || !confirmEnd) return;
    ending.current = true;
    await flush();
    await api(`/api/attempts/${attemptId}/finish`, { method: "POST" }).catch(() => undefined);
    finish();
  }

  // ---- resizable panes ----
  const container = useRef<HTMLDivElement>(null);
  const editorColumn = useRef<HTMLDivElement>(null);
  function drag(axis: "x" | "y") {
    return (event: React.PointerEvent) => {
      event.preventDefault();
      const move = (moveEvent: PointerEvent) => {
        if (axis === "x" && container.current) {
          const rect = container.current.getBoundingClientRect();
          setSplit(Math.min(70, Math.max(25, ((moveEvent.clientX - rect.left) / rect.width) * 100)));
        }
        if (axis === "y" && editorColumn.current) {
          const rect = editorColumn.current.getBoundingClientRect();
          setConsoleHeight(Math.min(75, Math.max(15, ((rect.bottom - moveEvent.clientY) / rect.height) * 100)));
        }
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  const urgent = remaining < 5 * 60_000;
  const warn = remaining < 15 * 60_000;
  const shown = shownKind[question.id] ?? "run";
  const result = results[`${question.id}:${shown}`] ?? null;
  const hasBoth = Boolean(results[`${question.id}:run`] && results[`${question.id}:submit`]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      {/* top bar */}
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-4">
        <Logo className="hidden md:inline-flex" />
        <span className="hidden h-6 w-px bg-line lg:block" />
        <p className="hidden max-w-60 truncate text-sm font-semibold lg:block">{title}</p>
        <nav className="flex gap-1.5 overflow-x-auto">
          {questions.map((entry, index) => {
            const score = best[entry.id];
            const solved = score && score.total > 0 && score.passed === score.total;
            const partial = score && !solved;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setActive(index)}
                title={entry.title}
                className={cx(
                  "flex h-9 min-w-9 items-center justify-center gap-1 rounded-lg border px-2.5 text-sm font-semibold",
                  index === active ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-ink hover:bg-sunken",
                )}
              >
                {index + 1}
                {solved && <span className="size-1.5 rounded-full bg-go" />}
                {partial && <span className="size-1.5 rounded-full bg-accent" />}
              </button>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <div
            className={cx(
              "flex items-center gap-2 rounded-full px-3.5 py-1.5 font-mono text-sm font-semibold tabular-nums",
              urgent ? "animate-pulse bg-error-soft text-error" : warn ? "bg-accent-soft text-accent" : "bg-sunken text-ink",
            )}
            aria-live="off"
          >
            <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
              <circle cx="8" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 6v3l2 1.5M6.5 2h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {formatClock(remaining)}
          </div>
          <div className="hidden text-right leading-tight xl:block">
            <p className="text-sm font-semibold">{studentName}</p>
            <p className="text-xs text-faint">{username}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setConfirmEnd(true)}>
            End exam
          </Button>
        </div>
      </header>

      {focusWarning && (
        <div className="flex items-center gap-3 bg-accent-soft px-4 py-2 text-sm text-accent">
          <strong>You left the exam window.</strong> This has been recorded and is visible to your invigilator.
          <button type="button" onClick={() => setFocusWarning(false)} className="ml-auto font-semibold hover:underline">
            Dismiss
          </button>
        </div>
      )}

      <div ref={container} className="flex min-h-0 flex-1">
        {/* problem */}
        <section style={{ width: `${split}%` }} className="min-w-0 overflow-y-auto border-r border-line bg-surface">
          <div className="px-6 py-6">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-accent">
              Question {active + 1} of {questions.length}
            </p>
            <h1 className="font-display text-2xl font-semibold tracking-tight">{question.title}</h1>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium text-muted">
              <span className="rounded-full bg-sunken px-2.5 py-1">{question.points} points</span>
              <span className="rounded-full bg-sunken px-2.5 py-1">Time limit {question.timeLimitMs / 1000}s</span>
              <span className="rounded-full bg-sunken px-2.5 py-1">Memory {question.memoryLimitMb} MB</span>
            </div>
            <div className="prose-exam mt-5">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{question.statement}</ReactMarkdown>
            </div>
            {question.samples.map((sample, index) => (
              <div key={index} className="mt-6">
                <p className="mb-2 font-display font-semibold">Sample {index}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">Input</p>
                    <pre className="overflow-x-auto rounded-lg border border-line bg-sunken px-3 py-2 font-mono text-[13px]">{sample.input}</pre>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">Output</p>
                    <pre className="overflow-x-auto rounded-lg border border-line bg-sunken px-3 py-2 font-mono text-[13px]">{sample.expected}</pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div onPointerDown={drag("x")} className="w-1.5 shrink-0 cursor-col-resize bg-line/40 hover:bg-brand/40" role="separator" aria-orientation="vertical" />

        {/* editor + console */}
        <section ref={editorColumn} className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
            <select
              value={language}
              onChange={(event) => changeLanguage(event.target.value as LanguageId)}
              className="rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-sm font-medium"
              aria-label="Language"
            >
              {languages.map((id) => (
                <option key={id} value={id}>
                  {LANGUAGES[id].label}
                </option>
              ))}
            </select>
            {language === "java" && <span className="text-xs text-faint">Class must be named Main</span>}
            <button
              type="button"
              onClick={() => window.confirm("Replace your code with the starter template?") && edit(LANGUAGES[language].template)}
              className="ml-auto text-xs font-medium text-muted hover:text-ink"
            >
              Reset code
            </button>
            <span className={cx("text-xs", saveState === "offline" ? "font-semibold text-error" : "text-faint")}>
              {saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : "Offline, retrying"}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden bg-surface">
            <CodeMirror
              key={key(question.id, language)}
              value={source}
              onChange={edit}
              height="100%"
              style={{ height: "100%", fontSize: 14 }}
              extensions={EXTENSIONS[language]}
              basicSetup={{ tabSize: 4, foldGutter: false, highlightActiveLine: true, autocompletion: false }}
            />
          </div>

          <div onPointerDown={drag("y")} className="h-1.5 shrink-0 cursor-row-resize bg-line/40 hover:bg-brand/40" role="separator" aria-orientation="horizontal" />

          <div style={{ height: `${consoleHeight}%` }} className="flex shrink-0 flex-col bg-surface">
            <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
              {(
                [
                  ["results", "Test results"],
                  ["custom", "Custom input"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  className={cx("rounded-md px-3 py-1.5 text-sm font-medium", tab === value ? "bg-sunken text-ink" : "text-muted hover:text-ink")}
                >
                  {label}
                </button>
              ))}
              {tab === "results" && hasBoth && (
                <div className="ml-auto flex rounded-full bg-sunken p-0.5 text-xs font-semibold">
                  {(["run", "submit"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setShownKind((current) => ({ ...current, [question.id]: kind }))}
                      className={cx("rounded-full px-3 py-1", shown === kind ? "bg-surface text-ink shadow-sm" : "text-muted")}
                    >
                      {kind === "run" ? "Last run" : "Last submission"}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1">
              {tab === "results" ? (
                <ResultPanel key={result?.id ?? "none"} submission={result} />
              ) : (
                <div className="flex h-full flex-col gap-2 p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={useCustom} onChange={(event) => setUseCustom(event.target.checked)} className="size-4 accent-brand" />
                    Test against custom input when I click Run
                  </label>
                  <textarea
                    value={customInput[question.id] ?? ""}
                    onChange={(event) => setCustomInput((current) => ({ ...current, [question.id]: event.target.value }))}
                    placeholder="Type stdin for your program…"
                    className="min-h-0 flex-1 resize-none rounded-lg border border-line-strong bg-sunken/50 p-3 font-mono text-[13px] focus:border-brand focus:outline-none"
                  />
                </div>
              )}
            </div>
          </div>

          <footer className="flex h-14 shrink-0 items-center gap-3 border-t border-line bg-surface px-4">
            {error && <p className="min-w-0 truncate text-sm font-medium text-error">{error}</p>}
            {best[question.id] && !error && (
              <p className="text-sm text-muted">
                Best: <strong className="text-ink">{best[question.id]!.passed}/{best[question.id]!.total}</strong> tests
              </p>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={() => execute("run")} disabled={runBusy}>
                {runBusy ? "Running…" : "Run code"}
              </Button>
              <Button variant="go" onClick={() => execute("submit")} disabled={submitting[question.id]}>
                {submitting[question.id] ? "Grading…" : "Submit"}
              </Button>
            </div>
          </footer>
        </section>
      </div>

      {confirmEnd && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl">
            <h2 className="font-display text-2xl font-semibold tracking-tight">End the exam?</h2>
            <p className="mt-2 text-sm text-muted">
              You can&apos;t come back after ending. Your latest code for every question is submitted automatically, and your best submission per question counts.
            </p>
            <ul className="mt-4 space-y-1 text-sm">
              {questions.map((entry, index) => (
                <li key={entry.id} className="flex justify-between">
                  <span>
                    Q{index + 1}. {entry.title}
                  </span>
                  <span className={best[entry.id] ? "text-pass" : "text-error"}>
                    {best[entry.id] ? `${best[entry.id]!.passed}/${best[entry.id]!.total} passed` : "Not submitted"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmEnd(false)}>
                Keep working
              </Button>
              <Button variant="danger" onClick={endExam}>
                End exam
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
