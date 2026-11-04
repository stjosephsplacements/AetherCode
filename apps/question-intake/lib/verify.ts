import { outputsMatch } from "./compare.ts";
import { runBatch, type ExecStatus } from "./engine.ts";
import type { LanguageId } from "./languages.ts";
import { type QuestionInput, normalizeQuestion } from "./question.ts";

export type TestVerdict = { index: number; passed: boolean; status: ExecStatus; timeMs: number | null; memoryKb: number | null; actual: string; stderr: string };
export type SolutionVerdict = { language: LanguageId; compileError?: string; tests: TestVerdict[]; passed: boolean };
export type Verification = { passed: boolean; solutions: SolutionVerdict[] };

const PREVIEW = 400;
const clip = (value: string) => (value.length > PREVIEW ? `${value.slice(0, PREVIEW)}…` : value);

/**
 * Runs every model solution against every test in the hosted judge. A question verifies only when each
 * solution compiles and produces exactly the expected output on every test, within the limits.
 */
export async function verifyQuestion(input: QuestionInput): Promise<Verification> {
  const question = normalizeQuestion(input);
  const solutions: SolutionVerdict[] = [];
  for (const solution of question.solutions) {
    const language = solution.language as LanguageId;
    // A function-only question is judged as the platform judges it: the author's function inside the wrapper (ADR-0063).
    const template = question.templates.find((entry) => entry.language === language);
    const source = template ? template.prefix + solution.source + template.suffix : solution.source;
    const batch = await runBatch({
      language,
      source,
      inputs: question.tests.map((test) => test.input),
      timeLimitMs: question.time_limit_ms,
      memoryLimitKb: question.memory_limit_kib,
    });
    if ("compileError" in batch) {
      solutions.push({ language, compileError: clip(batch.compileError), tests: [], passed: false });
      continue;
    }
    const tests = batch.results.map((result, index): TestVerdict => ({
      index,
      passed: result.status === "ok" && outputsMatch(result.stdout, question.tests[index]!.expected_output),
      status: result.status,
      timeMs: result.timeMs,
      memoryKb: result.memoryKb,
      actual: clip(result.stdout),
      stderr: clip(result.stderr),
    }));
    solutions.push({ language, tests, passed: tests.every((test) => test.passed) });
  }
  return { passed: solutions.length > 0 && solutions.every((solution) => solution.passed), solutions };
}
