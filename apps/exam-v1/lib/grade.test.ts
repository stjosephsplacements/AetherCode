import { test } from "node:test";
import assert from "node:assert/strict";
import type { Engine, ExecRequest, ExecResult } from "./engine.ts";
import { createLimiter, grade, type GradeTest } from "./grade.ts";

// Echoes "out:<stdin>" unless the stdin names a failure mode.
class FakeEngine implements Engine {
  calls = 0;
  constructor(private readonly compileFails = false) {}
  async execute(request: ExecRequest): Promise<ExecResult> {
    this.calls++;
    const base = { stderr: "", compileOutput: "", timeMs: 5, memoryKb: 1000 };
    if (this.compileFails) return { ...base, status: "compile_error", stdout: "", compileOutput: "error: x" };
    if (request.stdin === "tle") return { ...base, status: "time_limit", stdout: "" };
    if (request.stdin === "crash") return { ...base, status: "runtime_error", stdout: "" };
    return { ...base, status: "ok", stdout: `out:${request.stdin}\n` };
  }
}

const t = (input: string, expected: string | null, weight = 1): GradeTest => ({
  id: null,
  input,
  expectedOutput: expected,
  isSample: false,
  weight,
});
const job = (tests: GradeTest[]) => ({ language: "python" as const, source: "", timeLimitMs: 1000, memoryLimitKb: 65536, tests });

test("grade", async () => {
  const cases = [
    { name: "all pass", tests: [t("a", "out:a"), t("b", "out:b", 3)], verdict: "accepted", passed: 2, earned: 4 },
    { name: "wrong answer", tests: [t("a", "out:a"), t("b", "nope", 2)], verdict: "wrong_answer", passed: 1, earned: 1 },
    { name: "tle beats wa", tests: [t("a", "x"), t("tle", "x")], verdict: "time_limit_exceeded", passed: 0, earned: 0 },
    { name: "runtime error", tests: [t("crash", "x"), t("a", "out:a")], verdict: "runtime_error", passed: 1, earned: 1 },
    { name: "custom input", tests: [t("z", null)], verdict: "ran", passed: 0, earned: 0 },
  ];
  for (const testCase of cases) {
    const outcome = await grade(new FakeEngine(), createLimiter(2), job(testCase.tests));
    assert.equal(outcome.verdict, testCase.verdict, testCase.name);
    assert.equal(outcome.passed, testCase.passed, testCase.name);
    assert.equal(outcome.earnedWeight, testCase.earned, testCase.name);
  }
});

test("compile error short-circuits after one engine call", async () => {
  const engine = new FakeEngine(true);
  const outcome = await grade(engine, createLimiter(4), job([t("a", "x"), t("b", "y"), t("c", "z")]));
  assert.equal(engine.calls, 1);
  assert.equal(outcome.verdict, "compile_error");
  assert.equal(outcome.compileOutput, "error: x");
  assert.equal(outcome.outcomes.length, 3);
});

test("limiter caps concurrency", async () => {
  const limit = createLimiter(2);
  let active = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: 8 }, () =>
      limit(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
      }),
    ),
  );
  assert.equal(peak, 2);
});

test("batched grading compiles once per group and keeps test order", async () => {
  const calls: string[][] = [];
  const engine: Engine = {
    execute: () => Promise.reject(new Error("per-test path must not be used")),
    executeBatch: async (request) => {
      calls.push(request.inputs);
      return {
        results: request.inputs.map((input) => ({
          status: "ok" as const,
          stdout: `out:${input}\n`,
          stderr: "",
          compileOutput: "",
          timeMs: 1,
          memoryKb: null,
        })),
      };
    },
  };
  const tests = [t("h1", "out:h1"), { ...t("s1", "out:s1"), isSample: true }, t("h2", "bad")];
  const outcome = await grade(engine, createLimiter(2), job(tests));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.flat().sort(), ["h1", "h2", "s1"]);
  assert.deepEqual(outcome.outcomes.map((entry) => [entry.ord, entry.verdict]), [
    [0, "accepted"],
    [1, "accepted"],
    [2, "wrong_answer"],
  ]);
  assert.equal(outcome.verdict, "wrong_answer");
});

test("batched compile error marks every test", async () => {
  const engine: Engine = {
    execute: () => Promise.reject(new Error("unused")),
    executeBatch: async () => ({ compileError: "main.c:1: error" }),
  };
  const outcome = await grade(engine, createLimiter(2), job([t("a", "x"), { ...t("b", "y"), isSample: true }]));
  assert.equal(outcome.verdict, "compile_error");
  assert.equal(outcome.compileOutput, "main.c:1: error");
  assert.equal(outcome.outcomes.length, 2);
});
