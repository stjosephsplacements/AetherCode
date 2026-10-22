"use client";

import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { CodeRun, RunUnit } from "@/lib/api-types";
import { cn } from "@/lib/utils";

export type RunState =
  | { kind: "idle" }
  | { kind: "running"; custom: boolean }
  | { kind: "done"; run: CodeRun; custom: boolean }
  | { kind: "error"; message: string };

/** Verdicts that mean something for a custom-input run, which has no expected output. */
const CUSTOM_FAILURES = new Set(["time_limit_exceeded", "memory_limit_exceeded", "runtime_error", "compile_error", "internal_error"]);

const VERDICTS: Record<string, string> = {
  accepted: "Passed",
  wrong_answer: "Wrong answer",
  time_limit_exceeded: "Time limit exceeded",
  memory_limit_exceeded: "Memory limit exceeded",
  runtime_error: "Runtime error",
  compile_error: "Compilation error",
  internal_error: "Judge error, run again",
};

function verdictLabel(verdict: string | null): string {
  if (!verdict) return "No result";
  return VERDICTS[verdict] ?? verdict.replaceAll("_", " ");
}

function sortedUnits(run: CodeRun): RunUnit[] {
  return [...(run.units ?? [])].sort((a, b) => a.unit_number - b.unit_number);
}

/** One line for the collapsed console bar. */
export function runSummary(state: RunState): { text: string; tone: string } | null {
  if (state.kind === "running") return { text: state.custom ? "Running with your input" : "Running sample tests", tone: "text-ink-muted" };
  if (state.kind === "error") return { text: state.message, tone: "text-danger" };
  if (state.kind !== "done") return null;
  const units = sortedUnits(state.run);
  if (state.run.lifecycle_state === "failed" || units.length === 0) return { text: "The run could not finish", tone: "text-danger" };
  if (state.custom) {
    const verdict = units[0]!.verdict;
    return CUSTOM_FAILURES.has(verdict)
      ? { text: verdictLabel(verdict), tone: "text-danger" }
      : { text: "Ran with your input", tone: "text-ink-muted" };
  }
  const passed = units.filter((unit) => unit.verdict === "accepted").length;
  return passed === units.length
    ? { text: `All ${units.length} sample tests passed`, tone: "text-success" }
    : { text: `${passed} of ${units.length} sample tests passed`, tone: "text-danger" };
}

export function RunConsole({ state, idleText }: { state: RunState; idleText?: string }) {
  const [selected, setSelected] = useState(0);

  if (state.kind === "idle") {
    return <Empty>{idleText ?? "Run your code to check it against the sample tests."}</Empty>;
  }
  if (state.kind === "running") {
    return (
      <Empty>
        <LoaderCircle className="size-4 animate-spin" />
        {state.custom ? "Running with your input" : "Running your code"}
      </Empty>
    );
  }
  if (state.kind === "error") return <Empty className="text-danger">{state.message}</Empty>;

  const units = sortedUnits(state.run);
  if (state.run.lifecycle_state === "failed" || units.length === 0) {
    return <Empty className="text-danger">The run could not finish. Try again.</Empty>;
  }
  const compileOutput = units.find((unit) => unit.compile_output)?.compile_output;
  if (compileOutput) {
    return (
      <div className="h-full overflow-auto px-4 pb-4">
        <p className="mb-2 text-[13px] font-medium text-danger">Compilation error</p>
        <pre className="whitespace-pre-wrap rounded-[var(--radius-control)] bg-danger-soft p-3 font-mono text-xs leading-relaxed text-danger">
          {compileOutput}
        </pre>
      </div>
    );
  }
  if (state.custom) return <CustomResult unit={units[0]!} />;
  const current = units[Math.min(selected, units.length - 1)]!;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1 overflow-x-auto px-3 pb-2" role="tablist" aria-label="Sample tests">
        {units.map((unit, index) => {
          const passed = unit.verdict === "accepted";
          return (
            <button
              key={unit.unit_number}
              role="tab"
              aria-selected={index === selected}
              onClick={() => setSelected(index)}
              className={cn(
                "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors",
                index === selected ? "bg-surface font-medium text-ink shadow-[var(--shadow-hairline)] ring-1 ring-line" : "text-ink-muted hover:bg-hover",
              )}
            >
              {passed ? (
                <CircleCheck className="size-3.5 text-success" strokeWidth={2} />
              ) : (
                <CircleX className="size-3.5 text-danger" strokeWidth={2} />
              )}
              Test {index + 1}
            </button>
          );
        })}
      </div>
      <UnitDetail unit={current} />
    </div>
  );
}

function CustomResult({ unit }: { unit: RunUnit }) {
  const failed = CUSTOM_FAILURES.has(unit.verdict);
  return (
    <div className="h-full overflow-y-auto px-4 pb-4">
      <p className={cn("text-[13px] font-medium", failed ? "text-danger" : "text-ink")}>
        {failed ? verdictLabel(unit.verdict) : "Finished"}
        {unit.execution_time_ms !== null && <span className="ml-2 font-normal text-ink-subtle">{unit.execution_time_ms} ms</span>}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Block label="Your input" value={unit.stdin} />
        <Block label="Your output" value={unit.stdout} />
      </div>
      {unit.stderr && (
        <div className="mt-3">
          <Block label="Errors" value={unit.stderr} tone="danger" />
        </div>
      )}
    </div>
  );
}

function UnitDetail({ unit }: { unit: RunUnit }) {
  const passed = unit.verdict === "accepted";
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4" role="tabpanel">
      <p className={cn("text-[13px] font-medium", passed ? "text-success" : "text-danger")}>
        {verdictLabel(unit.verdict)}
        {unit.execution_time_ms !== null && <span className="ml-2 font-normal text-ink-subtle">{unit.execution_time_ms} ms</span>}
      </p>
      <div className="mt-3 grid gap-3">
        <Block label="Input" value={unit.stdin} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Block label="Expected output" value={unit.expected_output} />
          <Block label="Your output" value={unit.stdout} tone={passed ? undefined : "danger"} />
        </div>
        {unit.stderr && <Block label="Errors" value={unit.stderr} tone="danger" />}
      </div>
    </div>
  );
}

function Block({ label, value, tone }: { label: string; value: string | null; tone?: "danger" }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs text-ink-muted">{label}</p>
      <pre
        className={cn(
          "max-h-36 overflow-auto whitespace-pre-wrap rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-ink",
          tone === "danger" && "border-danger/30",
        )}
      >
        {value || <span className="text-ink-subtle">(empty)</span>}
      </pre>
    </div>
  );
}

function Empty({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-full items-center justify-center gap-2 px-6 pb-6 text-center text-[13px] text-ink-muted", className)}>{children}</div>
  );
}
