"use client";

import { CaretRight, CheckCircle, CircleNotch, Play, Warning, WarningCircle } from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LiveRefresh } from "@/lib/client/realtime";
import { CodeEditor } from "@/components/exam/code-editor";
import { useEditorSettings } from "@/components/exam/editor-settings";
import { EditorSettingsMenu } from "@/components/exam/editor-settings-menu";
import { Select } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import type { ModelCheck } from "@/lib/api-types";
import { useStoredText } from "@/lib/client/use-stored-text";
import { type Language, editorModeOf, nameOf } from "@/lib/languages";
import { type CheckStatus, checkStatus, firstProblem, newestFirst, passedCount, verdictLabel } from "@/lib/model-checks";
import { cn, formatTime } from "@/lib/utils";
import { runModelCheck } from "../actions";

/** A comment to start from; the line comment of the mode, nothing more. */
const starter = (editor: string) => `${editor === "python" ? "#" : "//"} Write a correct solution. It runs on every test, hidden ones included.\n`;

const BANNER: Record<CheckStatus, { tone: string; title: (checks: ModelCheck[], tests: number) => string; body: string }> = {
  idle: { tone: "border-line bg-surface", title: (_c, tests) => `Not verified. ${tests} tests are waiting.`, body: "Write a correct solution and run it. Every test, hidden ones included, has to pass before this question can be published." },
  running: { tone: "border-brand/40 bg-brand-soft", title: () => "Running your solution on every test", body: "This usually takes a few seconds." },
  verified: { tone: "border-success/40 bg-success-soft", title: () => "Verified. Every test passes.", body: "You can publish this question. If you replace the tests, you will need to verify again." },
  failing: { tone: "border-danger/40 bg-danger-soft", title: (checks) => `${passedCount(newestFirst(checks)[0]!)} of ${newestFirst(checks)[0]!.units.length} tests pass`, body: "A model solution has to pass all of them. Fix the solution, or the test if its expected output is wrong." },
  stale: { tone: "border-warning/40 bg-warning-soft", title: () => "The tests changed since the last check", body: "Run your solution again against the tests as they are now." },
  unrunnable: { tone: "border-warning/40 bg-warning-soft", title: () => "The check could not run", body: "Judge did not take the job. Try again in a moment; if it keeps happening, check System status." },
};

const ICON: Record<CheckStatus, React.ReactNode> = {
  idle: <WarningCircle className="size-5 text-ink-subtle" />,
  running: <CircleNotch className="size-5 animate-spin text-brand" />,
  verified: <CheckCircle className="size-5 text-success" />,
  failing: <WarningCircle className="size-5 text-danger" />,
  stale: <Warning className="size-5 text-warning" />,
  unrunnable: <Warning className="size-5 text-warning" />,
};

const UNIT_TONE: Record<string, string> = {
  accepted: "border-success/30 bg-success-soft text-success",
  wrong_answer: "border-danger/30 bg-danger-soft text-danger",
  runtime_error: "border-danger/30 bg-danger-soft text-danger",
  compile_error: "border-danger/30 bg-danger-soft text-danger",
  time_limit_exceeded: "border-warning/30 bg-warning-soft text-warning",
  memory_limit_exceeded: "border-warning/30 bg-warning-soft text-warning",
};

/**
 * Where a coding draft is proven correct: a Monaco editor for a model solution
 * and a run against every test, hidden ones included. Results arrive as the
 * check finishes. The server publishes only after a passing check on the
 * current tests (ADR-0047); this is how an author gets one.
 */
export function ModelCheckPanel({ versionId, languages, supported, checks, tests }: { versionId: string; languages: Language[]; supported: string[]; checks: ModelCheck[]; tests: number }) {
  const router = useRouter();
  const settings = useEditorSettings();
  const [language, setLanguage] = useState(supported[0] ?? "");
  const mode = editorModeOf(languages, language);
  const [source, setSource] = useStoredText(`aether.model-solution.${versionId}.${language}`, starter(mode));
  const [error, setError] = useState<string | null>(null);
  const [starting, startRun] = useTransition();
  const [earlier, setEarlier] = useState(false);

  const status = checkStatus(checks);
  const running = status === "running";
  const sorted = newestFirst(checks);
  const latest = sorted[0];

  function run() {
    if (starting || running) return;
    setError(null);
    startRun(async () => {
      const result = await runModelCheck(versionId, language, source);
      if (result.error) return setError(result.error);
      router.refresh();
    });
  }

  const banner = BANNER[status];
  const showUnits = latest && latest.units.length > 0 && !running;
  const problem = latest && latest.lifecycle_state === "completed" && status !== "verified" ? firstProblem(latest) : null;

  return (
    <div className="space-y-4">
      {running && <LiveRefresh topics={["grading"]} fallbackSeconds={2} />}
      <div role="status" className={cn("flex items-start gap-3 rounded-[var(--radius-surface)] border px-5 py-4", banner.tone)}>
        <span className="mt-0.5 shrink-0">{ICON[status]}</span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{banner.title(checks, tests)}</p>
          <p className="mt-0.5 text-[13px] text-ink-muted">{problem ?? banner.body}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
          <label htmlFor="check-language" className="sr-only">
            Language
          </label>
          <Select id="check-language" size="sm" className="w-44" value={language} onValueChange={setLanguage}>
            {supported.map((key) => (
              <option key={key} value={key}>
                {nameOf(languages, key)}
              </option>
            ))}
          </Select>
          <span className="hidden font-mono text-[11.5px] text-ink-subtle sm:inline">Ctrl or Cmd + Enter to run</span>
          <div className="ml-auto flex items-center gap-2">
            <EditorSettingsMenu />
            <Button type="button" onClick={run} disabled={starting || running || source.trim() === ""}>
              {starting || running ? <CircleNotch className="animate-spin" /> : <Play />}
              Run on all {tests} tests
            </Button>
          </div>
        </div>
        <div className="h-[24rem]">
          <CodeEditor path={`${versionId}-${language}`} language={mode} value={source} onChange={setSource} settings={settings} onRun={run} onSubmit={run} />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {showUnits && latest && (
        <div className="space-y-2">
          <p className="flex items-center gap-3 text-[13px] text-ink-muted">
            <span className="font-mono text-ink">{nameOf(languages, latest.language)}</span>
            <span className="font-mono tabular-nums">{formatTime(latest.requested_at)}</span>
            {latest.current === false && <span className="text-warning">on the previous tests</span>}
          </p>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {latest.units.map((unit) => (
              <li key={unit.unit_number} className={cn("rounded-[var(--radius-control)] border px-3 py-2", UNIT_TONE[unit.verdict] ?? "border-line bg-hover text-ink-muted")}>
                <p className="font-mono text-[11px] uppercase tracking-[0.06em] opacity-80">Test {unit.unit_number + 1}</p>
                <p className="mt-0.5 flex items-baseline justify-between gap-2 text-[13px] font-medium">
                  <span className="truncate capitalize">{verdictLabel(unit.verdict)}</span>
                  {unit.time_ms !== undefined && <span className="font-mono text-[11px] font-normal tabular-nums opacity-80">{unit.time_ms} ms</span>}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {sorted.length > 1 && (
        <div>
          <button type="button" aria-expanded={earlier} onClick={() => setEarlier((open) => !open)} className="flex items-center gap-1.5 text-[13px] text-ink-muted transition-colors hover:text-ink">
            <CaretRight className={cn("size-4 transition-transform duration-200", earlier && "rotate-90")} />
            Earlier checks ({sorted.length - 1})
          </button>
          {earlier && (
            <ul className="mt-2 divide-y divide-line overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface">
              {sorted.slice(1, 11).map((check) => (
                <li key={check.id} className="flex items-center gap-4 px-4 py-2 text-[13px]">
                  <span className="font-mono tabular-nums text-ink-muted">{formatTime(check.requested_at)}</span>
                  <span className="text-ink">{nameOf(languages, check.language)}</span>
                  <span className={cn("ml-auto font-mono tabular-nums", check.lifecycle_state === "failed" ? "text-warning" : passedCount(check) === check.units.length ? "text-success" : "text-danger")}>
                    {check.lifecycle_state === "failed" ? "could not run" : `${passedCount(check)} of ${check.units.length} pass`}
                  </span>
                  {check.current === false && <span className="text-[12px] text-ink-subtle">older tests</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
