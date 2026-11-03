import assert from "node:assert/strict";
import { test } from "node:test";
import { QuestionSchema, checkVerification, contentHash, signVerification } from "./question.ts";

process.env.VERIFY_SECRET = "test-secret";

const valid = {
  title: "Sum of two numbers",
  difficulty: "easy" as const,
  topics: ["math"],
  statement_md: "Print the sum of two integers.",
  input_format: "a b",
  output_format: "a+b",
  constraints_md: "",
  time_limit_ms: 2000,
  memory_limit_kb: 262144,
  tests: [
    { input: "1 2\n", expected_output: "3\n", is_sample: true },
    { input: "5 7\n", expected_output: "12\n", is_sample: false },
  ],
  solutions: [{ language: "python", source: "print(sum(map(int, input().split())))" }],
};

test("a complete question parses", () => {
  assert.equal(QuestionSchema.safeParse(valid).success, true);
});

test("a question needs tests, a sample, and one solution per language", () => {
  assert.equal(QuestionSchema.safeParse({ ...valid, tests: valid.tests.slice(0, 1) }).success, false);
  assert.equal(QuestionSchema.safeParse({ ...valid, tests: valid.tests.map((t) => ({ ...t, is_sample: false })) }).success, false);
  assert.equal(QuestionSchema.safeParse({ ...valid, solutions: [] }).success, false);
  assert.equal(QuestionSchema.safeParse({ ...valid, solutions: [valid.solutions[0], valid.solutions[0]] }).success, false);
  assert.equal(QuestionSchema.safeParse({ ...valid, solutions: [{ language: "cobol", source: "x" }] }).success, false);
});

test("the hash changes with the tests, the solution and the limits, not with the topics", () => {
  const base = contentHash(valid as never);
  assert.notEqual(base, contentHash({ ...valid, tests: [valid.tests[0]!, { ...valid.tests[1]!, expected_output: "13\n" }] } as never));
  assert.notEqual(base, contentHash({ ...valid, solutions: [{ language: "python", source: "print(0)" }] } as never));
  assert.notEqual(base, contentHash({ ...valid, time_limit_ms: 1000 } as never));
  assert.equal(base, contentHash({ ...valid, topics: ["other"] } as never));
});

test("a verification token is bound to the hash, the person and time", () => {
  const hash = contentHash(valid as never);
  const token = signVerification(hash, "p1", 1_000);
  assert.equal(checkVerification(token, hash, "p1", 2_000), true);
  assert.equal(checkVerification(token, hash + "0", "p1", 2_000), false);
  assert.equal(checkVerification(token, hash, "p2", 2_000), false);
  assert.equal(checkVerification(token, hash, "p1", 1_000 + 31 * 60_000), false);
  assert.equal(checkVerification("1.abc", hash, "p1", 0), false);
});
