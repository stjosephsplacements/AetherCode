import { outputsMatch } from "./compare.ts";
import type { Engine, ExecResult } from "./engine.ts";
import type { LanguageId } from "./languages.ts";

export type Verdict =
  | "accepted"
  | "wrong_answer"
  | "time_limit_exceeded"
  | "memory_limit_exceeded"
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
  "memory_limit_exceeded",
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
    case "memory_limit":
      return "memory_limit_exceeded";
    case "runtime_error":
      return "runtime_error";
    case "internal_error":
      return "internal_error";
    case "ok":
      if (test.expectedOutput === null) return "ran";
      return outputsMatch(result.stdout, test.expectedOutput) ? "accepted" : "wrong_answer";
  }
}

function summarize(job: GradeJob, outcomes: TestOutcome[], compileOutput: string): GradeOutcome {
  const passedOutcomes = outcomes.filter((outcome) => outcome.verdict === "accepted");
  const worst = VERDICT_PRIORITY.find((verdict) => outcomes.some((outcome) => outcome.verdict === verdict)) ?? "internal_error";
  return {
    verdict: worst,
    compileOutput,
    passed: passedOutcomes.length,
    earnedWeight: passedOutcomes.reduce((sum, outcome) => sum + outcome.test.weight, 0),
    totalWeight: job.tests.reduce((sum, test) => sum + test.weight, 0),
    outcomes,
  };
}

function compileFailure(job: GradeJob, compileOutput: string): GradeOutcome {
  return summarize(
    job,
    job.tests.map((test, ord) => ({ ord, test, verdict: "compile_error", stdout: "", stderr: "", timeMs: null, memoryKb: null })),
    compileOutput,
  );
}

// Compile-once path: one engine job per group. Samples and hidden tests are
// separate groups so a program can never read hidden inputs during a run whose
// output the student gets to see.
async function gradeInBatches(
  executeBatch: NonNullable<Engine["executeBatch"]>,
  limit: Limiter,
  job: GradeJob,
): Promise<GradeOutcome> {
  const groups = [true, false]
    .map((sample) => job.tests.map((test, ord) => ({ test, ord })).filter((entry) => entry.test.isSample === sample))
    .filter((group) => group.length > 0);
  const results = await Promise.all(
    groups.map((group) =>
      limit(() =>
        executeBatch({
          language: job.language,
          source: job.source,
          inputs: group.map((entry) => entry.test.input),
          timeLimitMs: job.timeLimitMs,
          memoryLimitKb: job.memoryLimitKb,
        }),
      ),
    ),
  );
  const outcomes: TestOutcome[] = [];
  for (const [index, result] of results.entries()) {
    if ("compileError" in result) return compileFailure(job, result.compileError);
    groups[index].forEach((entry, position) => {
      const execResult = result.results[position];
      outcomes.push({
        ord: entry.ord,
        test: entry.test,
        verdict: verdictFor(execResult, entry.test),
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        timeMs: execResult.timeMs,
        memoryKb: execResult.memoryKb,
      });
    });
  }
  outcomes.sort((a, b) => a.ord - b.ord);
  return summarize(job, outcomes, "");
}

// Per-test path: runs the first test alone so a compile error costs one engine
// call, then fans the remaining tests out through the shared limiter.
export async function grade(engine: Engine, limit: Limiter, job: GradeJob): Promise<GradeOutcome> {
  if (job.tests.length === 0) throw new Error("grade requires at least one test");
  if (engine.executeBatch) return gradeInBatches(engine.executeBatch.bind(engine), limit, job);
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

  const [first, ...rest] = job.tests;
  const firstResult = await execute(first);
  if (firstResult.status === "compile_error") return compileFailure(job, firstResult.compileOutput);
  const restResults = await Promise.all(rest.map((test) => execute(test)));
  const outcomes = [toOutcome(0, first, firstResult), ...restResults.map((result, index) => toOutcome(index + 1, rest[index], result))];
  return summarize(job, outcomes, firstResult.compileOutput);
}
