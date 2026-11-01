import type { ModelCheck } from "./api-types";

export type CheckStatus = "idle" | "running" | "verified" | "failing" | "stale" | "unrunnable";

export const newestFirst = (checks: ModelCheck[]): ModelCheck[] => [...checks].sort((a, b) => Date.parse(b.requested_at) - Date.parse(a.requested_at));

/** ADR-0047: a passing check on the tests as they are now, in any language. The server enforces the same rule. */
export const isVerified = (checks: ModelCheck[]): boolean => checks.some((check) => check.lifecycle_state === "completed" && check.verdict === "accepted" && check.current === true);

export const passedCount = (check: ModelCheck): number => check.units.filter((unit) => unit.verdict === "accepted").length;

/** Where a draft stands: nothing run, running, passing, failing, passing only on older tests, or Judge could not run it. */
export function checkStatus(checks: ModelCheck[]): CheckStatus {
  if (checks.some((check) => check.lifecycle_state === "queued")) return "running";
  if (isVerified(checks)) return "verified";
  const latest = newestFirst(checks)[0];
  if (!latest) return "idle";
  if (latest.lifecycle_state === "failed") return "unrunnable";
  return latest.current === true ? "failing" : "stale";
}

const ADVICE: Record<string, string> = {
  wrong_answer: "The solution printed something else. Either it is wrong or this test's expected output is.",
  runtime_error: "The solution crashed on this input.",
  compile_error: "The solution did not compile.",
  time_limit_exceeded: "The solution ran past the time limit. Raise the limit or use a faster approach.",
  memory_limit_exceeded: "The solution used more memory than the limit allows.",
};

/** The first thing to look at in a failing check, in plain words. */
export function firstProblem(check: ModelCheck): string | null {
  const failing = check.units.find((unit) => unit.verdict !== "accepted");
  if (!failing) return null;
  return `Test ${failing.unit_number + 1}: ${ADVICE[failing.verdict] ?? `verdict ${failing.verdict.replaceAll("_", " ")}.`}`;
}

export const verdictLabel = (verdict: string) => (verdict === "accepted" ? "passes" : verdict.replaceAll("_", " "));
