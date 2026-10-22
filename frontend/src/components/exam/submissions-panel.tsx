"use client";

import { CircleCheck, CircleX, LoaderCircle, Lock } from "lucide-react";
import type { ItemSubmission } from "@/lib/api-types";
import { cn, formatTime, languageName } from "@/lib/utils";
import { formatScore } from "./question-rail";

const VERDICTS: Record<string, string> = {
  accepted: "passed",
  wrong_answer: "wrong answer",
  time_limit_exceeded: "time limit exceeded",
  memory_limit_exceeded: "memory limit exceeded",
  runtime_error: "runtime error",
  compile_error: "compilation error",
  internal_error: "judge error",
};

/** One line per verdict count, failures first: "2 wrong answer, 1 time limit exceeded". */
function failureSummary(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([verdict]) => verdict !== "accepted")
    .sort((a, b) => b[1] - a[1])
    .map(([verdict, count]) => `${count} ${VERDICTS[verdict] ?? verdict.replaceAll("_", " ")}`)
    .join(", ");
}

/** The question's submissions: score, passed tests and why the rest failed. */
export function SubmissionsPanel({ items }: { items: ItemSubmission[] | undefined }) {
  if (!items) {
    return (
      <Empty>
        <LoaderCircle className="size-4 animate-spin" />
        Loading submissions
      </Empty>
    );
  }
  if (items.length === 0) {
    return <Empty>Submit your code to check it against all test cases, including hidden ones. Your best submission counts.</Empty>;
  }
  return (
    <div className="h-full space-y-2 overflow-y-auto px-3 pb-3">
      <p className="flex items-center gap-1.5 px-1 text-xs text-ink-muted">
        <Lock className="size-3" strokeWidth={2} />
        Hidden test cases show pass counts only. Your best submission counts.
      </p>
      {items.map((item) => (
        <Submission key={item.id} item={item} />
      ))}
    </div>
  );
}

function Submission({ item }: { item: ItemSubmission }) {
  const judging = item.lifecycle_state === "queued" || item.lifecycle_state === "dispatched";
  const failed = item.lifecycle_state === "failed" || item.lifecycle_state === "cancelled";
  const passed = item.passed_units ?? 0;
  const total = item.total_units ?? 0;
  const allPassed = !judging && !failed && total > 0 && passed === total;
  const compileError = item.verdict === "compile_error" && total === 0;
  const failures = failureSummary(item.verdict_counts);

  return (
    <div className="rounded-[var(--radius-control)] border border-line bg-surface px-3.5 py-3">
      <div className="flex items-center gap-2.5">
        {judging ? (
          <LoaderCircle className="size-4 animate-spin text-ink-muted" />
        ) : allPassed ? (
          <CircleCheck className="size-4 text-success" strokeWidth={2} />
        ) : (
          <CircleX className="size-4 text-danger" strokeWidth={2} />
        )}
        <p className={cn("text-[13px] font-medium", judging ? "text-ink" : allPassed ? "text-success" : "text-danger")}>
          {judging
            ? "Judging your submission"
            : failed
              ? "The judge could not evaluate this submission"
              : compileError
                ? "Compilation error"
                : allPassed
                  ? `All ${total} test cases passed`
                  : `${passed} of ${total} test cases passed`}
        </p>
        {item.score !== null && item.maximum_score && (
          <span className="ml-auto rounded-full bg-hover px-2.5 py-0.5 font-mono text-xs font-medium tabular-nums text-ink">
            {formatScore(Number(item.score))} / {formatScore(Number(item.maximum_score))}
          </span>
        )}
      </div>
      {!judging && failures && <p className="mt-1.5 pl-[26px] text-xs text-ink-muted">{failures}</p>}
      <p className="mt-2 pl-[26px] text-xs text-ink-subtle">
        {item.origin === "final" ? "Evaluated at the end of the test" : "Submitted"} {formatTime(item.queued_at)}
        {item.language_id && `, ${languageName(item.language_id)}`}
      </p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center gap-2 px-8 pb-6 text-center text-[13px] leading-relaxed text-ink-muted">{children}</div>;
}
