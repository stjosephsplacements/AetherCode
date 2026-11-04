import assert from "node:assert/strict";
import { test } from "node:test";
import { QuestionSchema, checkVerification, contentHash, normalizeQuestion, signVerification } from "./question.ts";

process.env.VERIFY_SECRET = "test-secret";

const topic = "018f4b0d-08f8-7c09-9ba7-efdf9c223366";
const coding = {
  topic_id: topic,
  kind: "coding" as const,
  title: "Sum of two numbers",
  difficulty: "easy" as const,
  audience: "practice" as const,
  tags: ["Math", "basic stuff"],
  prompt_markdown: "Read a and b, where 1 <= a, b <= 10^9, and print the sum.\nInput: two integers\nOutput: the sum",
  languages: ["python3"],
  time_limit_ms: 2000,
  memory_limit_kib: 262144,
  tests: [
    { input: "1 2", expected_output: "3", is_sample: true, weight: 1 },
    { input: "5 7", expected_output: "12", is_sample: false, weight: 2 },
  ],
  solutions: [{ language: "python3", source: "print(sum(map(int, input().split())))" }],
  templates: [],
  choices: [],
  correct_choices: [],
  multiple_choice: false,
  choice_explanations: [],
};
const mcq = { ...coding, kind: "mcq" as const, languages: [], tests: [], solutions: [], choices: ["O(n)", "O(n^2)", "O(1)"], correct_choices: [1], choice_explanations: ["", "Two nested loops.", ""] };

test("a complete coding question and a complete multiple-choice question parse", () => {
  assert.equal(QuestionSchema.safeParse(coding).success, true);
  assert.equal(QuestionSchema.safeParse(mcq).success, true);
});

test("coding questions follow the platform's rules", () => {
  const bad = (patch: object) => QuestionSchema.safeParse({ ...coding, ...patch }).success;
  assert.equal(bad({ tests: [coding.tests[0]] }), false, "needs a hidden test");
  assert.equal(bad({ tests: [coding.tests[1]] }), false, "needs a sample");
  assert.equal(bad({ languages: [] }), false);
  assert.equal(bad({ solutions: [] }), false);
  assert.equal(bad({ solutions: [{ language: "java", source: "x" }] }), false, "a solution in an unsupported language");
  assert.equal(bad({ tests: [{ ...coding.tests[0], weight: 0 }, coding.tests[1]] }), false);
  assert.equal(bad({ slug: "A_B" }), false);
  assert.equal(bad({ memory_limit_kib: 1024 }), false);
});

test("multiple-choice questions follow the platform's rules", () => {
  const bad = (patch: object) => QuestionSchema.safeParse({ ...mcq, ...patch }).success;
  assert.equal(bad({ choices: ["only one"] }), false);
  assert.equal(bad({ correct_choices: [] }), false);
  assert.equal(bad({ correct_choices: [0, 1] }), false, "single answer");
  assert.equal(bad({ correct_choices: [0, 1], multiple_choice: true }), true);
  assert.equal(bad({ correct_choices: [5] }), false);
});

test("saving normalises the statement, tags, slug and tests", () => {
  const normal = normalizeQuestion(coding);
  assert.equal(normal.slug, "sum-of-two-numbers");
  assert.deepEqual(normal.tags, ["math", "basic-stuff"]);
  assert.match(normal.prompt_markdown, /\$1 \\le a/);
  assert.match(normal.prompt_markdown, /## Input Format\n\ntwo integers/);
  assert.equal(normal.tests[0]!.input, "1 2\n");
  assert.equal(normal.tests[0]!.expected_output, "3\n");
  const mathOptions = normalizeQuestion(mcq);
  assert.equal(mathOptions.choices[1], "O($n^{2}$)");
  assert.deepEqual(mathOptions.choice_explanations, ["", "Two nested loops.", ""]);
});

test("the hash changes with what the judge ran, not with tags or audience", () => {
  const base = contentHash(coding);
  assert.notEqual(base, contentHash({ ...coding, tests: [coding.tests[0]!, { ...coding.tests[1]!, expected_output: "13" }] }));
  assert.notEqual(base, contentHash({ ...coding, solutions: [{ language: "python3", source: "print(0)" }] }));
  assert.notEqual(base, contentHash({ ...coding, time_limit_ms: 1000 }));
  assert.equal(base, contentHash({ ...coding, tags: ["other"], audience: "test" }));
  // Writing the statement already in the platform's format changes nothing.
  assert.equal(contentHash({ ...coding, prompt_markdown: normalizeQuestion(coding).prompt_markdown }), base);
});

test("a verification token is bound to the hash, the person and time", () => {
  const hash = contentHash(coding);
  const token = signVerification(hash, "p1", 1_000);
  assert.equal(checkVerification(token, hash, "p1", 2_000), true);
  assert.equal(checkVerification(token, hash + "0", "p1", 2_000), false);
  assert.equal(checkVerification(token, hash, "p2", 2_000), false);
  assert.equal(checkVerification(token, hash, "p1", 1_000 + 31 * 60_000), false);
  assert.equal(checkVerification("1.abc", hash, "p1", 0), false);
});
