"use client";

import { useState } from "react";
import { VERDICT_LABEL } from "@/lib/verdicts";
import { cx } from "@/components/ui";

export interface TestView {
  ord: number;
  sample: boolean;
  verdict: string;
  input?: string;
  expected?: string | null;
  stdout?: string | null;
  stderr?: string | null;
  timeMs?: number | null;
}

export interface SubmissionView {
  id: string;
  kind: "run" | "submit";
  status: "queued" | "running" | "done" | "error";
  verdict?: string | null;
  passed?: number;
  total?: number;
  compileOutput?: string | null;
  tests?: TestView[];
}

const MESSAGE: Record<string, string> = {
  wrong_answer: "Your output does not match the expected output.",
  time_limit_exceeded: "Your code took too long. Optimize it or check for an infinite loop.",
  runtime_error: "Your program crashed or exited with a non-zero status.",
  internal_error: "The judge could not run this. Try again.",
};

function Block({ label, value, tone }: { label: string; value: string; tone?: "error" }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">{label}</p>
      <pre
        className={cx(
          "max-h-40 overflow-auto rounded-lg border px-3 py-2 font-mono text-[13px] leading-relaxed",
          tone === "error" ? "border-error/20 bg-error-soft text-error" : "border-line bg-sunken text-ink",
        )}
      >
        {value === "" ? <span className="text-faint">(empty)</span> : value}
      </pre>
    </div>
  );
}

const Tick = () => (
  <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-pass" aria-hidden="true">
    <circle cx="8" cy="8" r="7" fill="currentColor" opacity=".15" />
    <path d="m5 8.2 2 2 4-4.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Cross = () => (
  <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-fail" aria-hidden="true">
    <circle cx="8" cy="8" r="7" fill="currentColor" opacity=".15" />
    <path d="m5.5 5.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const Lock = () => (
  <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-faint" aria-hidden="true">
    <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

export function ResultPanel({ submission }: { submission: SubmissionView | null }) {
  const [selected, setSelected] = useState(0);

  if (!submission) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-sm text-muted">
        <p>
          <strong className="text-ink">Run code</strong> to test against the sample cases, or <strong className="text-ink">Submit</strong> to grade against all
          test cases.
        </p>
      </div>
    );
  }
  if (submission.status === "queued" || submission.status === "running") {
    return (
      <div className="grid h-full place-items-center text-sm text-muted">
        <div className="flex items-center gap-3">
          <span className="size-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          {submission.kind === "submit"
            ? "Submission saved. Grading against all test cases — you can keep working."
            : submission.status === "queued"
              ? "Waiting for the judge…"
              : "Running sample tests…"}
        </div>
      </div>
    );
  }
  if (submission.verdict === "compile_error") {
    return (
      <div className="h-full overflow-auto p-4">
        <p className="mb-3 font-display text-lg font-semibold text-error">Compilation error</p>
        <Block label="Compiler output" value={submission.compileOutput ?? ""} tone="error" />
      </div>
    );
  }
  const tests = submission.tests ?? [];
  if (tests.length === 0) {
    return <div className="p-4 text-sm text-error">{submission.compileOutput || "The judge could not evaluate this. Try again."}</div>;
  }
  const custom = submission.verdict === "ran";
  const allPassed = submission.passed === submission.total;
  const current = tests[Math.min(selected, tests.length - 1)];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        {custom ? (
          <p className="font-display font-semibold">Custom input run</p>
        ) : (
          <>
            <p className={cx("font-display text-lg font-semibold", allPassed ? "text-pass" : "text-fail")}>
              {allPassed ? (submission.kind === "submit" ? "All test cases passed" : "Sample tests passed") : VERDICT_LABEL[submission.verdict ?? ""] ?? "Failed"}
            </p>
            <p className="text-sm text-muted">
              {submission.passed}/{submission.total} test cases passed
            </p>
          </>
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        <ul className="w-44 shrink-0 overflow-auto border-r border-line py-1">
          {tests.map((test, index) => (
            <li key={test.ord}>
              <button
                type="button"
                onClick={() => setSelected(index)}
                className={cx(
                  "flex w-full items-center gap-2 px-4 py-2 text-left text-sm",
                  index === selected ? "bg-brand-soft font-semibold text-brand-ink" : "text-ink-soft hover:bg-sunken",
                )}
              >
                {test.verdict === "accepted" || test.verdict === "ran" ? <Tick /> : <Cross />}
                {custom ? "Custom input" : `Test case ${index}`}
                {!test.sample && <Lock />}
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0 flex-1 space-y-3 overflow-auto p-4">
          {current.sample ? (
            <>
              {MESSAGE[current.verdict] && <p className="text-sm font-medium text-fail">{MESSAGE[current.verdict]}</p>}
              <Block label="Input" value={current.input ?? ""} />
              <Block label="Your output" value={current.stdout ?? ""} />
              {current.expected != null && <Block label="Expected output" value={current.expected} />}
              {current.stderr && <Block label="Error output" value={current.stderr} tone="error" />}
              {current.timeMs != null && <p className="text-xs text-faint">Ran in {current.timeMs} ms</p>}
            </>
          ) : (
            <div className="grid h-full place-items-center text-center text-sm text-muted">
              <div>
                <p className={cx("mb-1 font-semibold", current.verdict === "accepted" ? "text-pass" : "text-fail")}>
                  {VERDICT_LABEL[current.verdict] ?? current.verdict}
                </p>
                <p>This is a hidden test case. Its input and output are not shown.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
