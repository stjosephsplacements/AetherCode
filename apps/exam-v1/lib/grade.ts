import { outputsMatch } from "./compare.ts";
import type { Engine, ExecResult } from "./engine.ts";
import type { LanguageId } from "./languages.ts";

export type Verdict =
  | "accepted"
  | "wrong_answer"
  | "time_limit_exceeded"
  | "runtime_error"
  | "compile_error"
  | "internal_error"
  | "ran";

export interface GradeTest {
  id: string | null;
  input: string;
  // null for a custom-input run: there is nothing to compare against.
  expectedOutput: string | null;
  isSample: boolean;
  weight: number;
}

export interface GradeJob {
  language: LanguageId;
  source: string;
  timeLimitMs: number;
  memoryLimitKb: number;
  tests: GradeTest[];
}

export interface TestOutcome {
  ord: number;
  test: GradeTest;
  verdict: Verdict;
  stdout: string;
  stderr: string;
  timeMs: number | null;
  memoryKb: number | null;
}

export interface GradeOutcome {
  verdict: Verdict;
  compileOutput: string;
  passed: number;
  earnedWeight: number;
  totalWeight: number;
  outcomes: TestOutcome[];
}

export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

export function createLimiter(concurrency: number): Limiter {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async (task) => {
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

const VERDICT_PRIORITY: Verdict[] = [
  "compile_error",
  "internal_error",
  "runtime_error",
  "time_limit_exceeded",
  "wrong_answer",
  "ran",
  "accepted",
];

function verdictFor(result: ExecResult, test: GradeTest): Verdict {
  switch (result.status) {
    case "compile_error":
      return "compile_error";
    case "time_limit":
      return "time_limit_exceeded";
    case "runtime_error":
      return "runtime_error";
    case "internal_error":
      return "internal_error";
    case "ok":
      if (test.expectedOutput === null) return "ran";
      return outputsMatch(result.stdout, test.expectedOutput) ? "accepted" : "wrong_answer";
  }
}

// Runs the first test alone so a compile error costs one engine call, then
// fans the remaining tests out through the shared limiter.
export async function grade(engine: Engine, limit: Limiter, job: GradeJob): Promise<GradeOutcome> {
  const execute = (test: GradeTest) =>
    limit(() =>
      engine.execute({
        language: job.language,
        source: job.source,
        stdin: test.input,
        timeLimitMs: job.timeLimitMs,
        memoryLimitKb: job.memoryLimitKb,
      }),
    );
  const toOutcome = (ord: number, test: GradeTest, result: ExecResult): TestOutcome => ({
    ord,
    test,
    verdict: verdictFor(result, test),
    stdout: result.stdout,
    stderr: result.stderr,
    timeMs: result.timeMs,
    memoryKb: result.memoryKb,
  });

  if (job.tests.length === 0) throw new Error("grade requires at least one test");
  const totalWeight = job.tests.reduce((sum, test) => sum + test.weight, 0);
  const [first, ...rest] = job.tests;
  const firstResult = await execute(first);
  if (firstResult.status === "compile_error") {
    return {
      verdict: "compile_error",
      compileOutput: firstResult.compileOutput,
      passed: 0,
      earnedWeight: 0,
      totalWeight,
      outcomes: job.tests.map((test, ord) => ({
        ord,
        test,
        verdict: "compile_error",
        stdout: "",
        stderr: "",
        timeMs: null,
        memoryKb: null,
      })),
    };
  }
  const restResults = await Promise.all(rest.map((test) => execute(test)));
  const outcomes = [toOutcome(0, first, firstResult), ...restResults.map((result, index) => toOutcome(index + 1, rest[index], result))];
  const passedOutcomes = outcomes.filter((outcome) => outcome.verdict === "accepted");
  const worst = VERDICT_PRIORITY.find((verdict) => outcomes.some((outcome) => outcome.verdict === verdict)) ?? "internal_error";
  return {
    verdict: worst,
    compileOutput: firstResult.compileOutput,
    passed: passedOutcomes.length,
    earnedWeight: passedOutcomes.reduce((sum, outcome) => sum + outcome.test.weight, 0),
    totalWeight,
    outcomes,
  };
}
