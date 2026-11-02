import { describe, expect, it } from "vitest";
import { type Details, blankDetails, blankTest, choicesProblem, cleanTags, detailsProblem, explanationsBody, marksShare, normalizeTag, prepareTests, slugOf, slugify, summarizeTests, testsProblem, withNewline } from "./model";

const valid: Details = { ...blankDetails(["python3"], "018f4b0d-08f8-7c09-9ba7-efdf9c220c01"), title: "Sum of two numbers", prompt: "Print a + b." };

describe("details", () => {
  it("accepts a complete coding question", () => {
    expect(detailsProblem(valid)).toBeNull();
  });

  it("says what is missing, one thing at a time", () => {
    expect(detailsProblem({ ...valid, title: "  " })).toMatch(/title/i);
    expect(detailsProblem({ ...valid, categoryId: "" })).toMatch(/category/i);
    expect(detailsProblem({ ...valid, prompt: "" })).toMatch(/statement/i);
    expect(detailsProblem({ ...valid, languages: [] })).toMatch(/language/i);
    expect(detailsProblem({ ...valid, timeSeconds: 0 })).toMatch(/time limit/i);
    expect(detailsProblem({ ...valid, timeSeconds: 61 })).toMatch(/time limit/i);
    expect(detailsProblem({ ...valid, memoryMb: 8 })).toMatch(/memory limit/i);
  });

  it("does not ask a multiple-choice question for languages or limits", () => {
    expect(detailsProblem({ ...valid, kind: "mcq", languages: [], timeSeconds: 0, memoryMb: 0 })).toBeNull();
  });

  it("needs a slug the question bank accepts", () => {
    expect(slugify("Sum of Two Numbers!")).toBe("sum-of-two-numbers");
    expect(slugOf({ title: "Sum", slug: "  custom-slug " })).toBe("custom-slug");
    expect(detailsProblem({ ...valid, title: "A?" })).toMatch(/slug/i);
    expect(detailsProblem({ ...valid, title: "A?", slug: "a-b" })).toBeNull();
    expect(slugify("x".repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

describe("tests", () => {
  const sample = { ...blankTest(true), input: "1 2", expected_output: "3" };
  const hidden = { ...blankTest(false), input: "5 5", expected_output: "10" };

  it("needs a sample and a hidden test", () => {
    expect(testsProblem([])).toMatch(/at least one test/i);
    expect(testsProblem([sample])).toMatch(/hidden/i);
    expect(testsProblem([hidden])).toMatch(/sample/i);
    expect(testsProblem([sample, hidden])).toBeNull();
  });

  it("names the test with no expected output", () => {
    expect(testsProblem([sample, { ...hidden, expected_output: " \n" }])).toBe("Test 2 has no expected output.");
  });

  it("keeps weights to whole numbers from 1 to 100", () => {
    expect(testsProblem([sample, { ...hidden, weight: 0 }])).toMatch(/Test 2/);
    expect(testsProblem([sample, { ...hidden, weight: 1.5 }])).toMatch(/Test 2/);
    expect(testsProblem([sample, { ...hidden, weight: 101 }])).toMatch(/Test 2/);
  });

  it("ends every value in a newline before saving, once", () => {
    expect(withNewline("3")).toBe("3\n");
    expect(withNewline("3\n")).toBe("3\n");
    expect(withNewline("")).toBe("");
    expect(prepareTests([sample])[0]).toMatchObject({ input: "1 2\n", expected_output: "3\n" });
  });

  it("shares the marks by weight", () => {
    const tests = [sample, { ...hidden, weight: 3 }];
    expect(summarizeTests(tests)).toEqual({ total: 2, sample: 1, hidden: 1, weight: 4 });
    expect([marksShare(tests[0]!, tests), marksShare(tests[1]!, tests)]).toEqual([25, 75]);
  });
});

describe("options", () => {
  it("needs two filled options and a correct answer", () => {
    expect(choicesProblem({ options: ["a", ""], correct: [0], multiple: false, explanations: [] })).toMatch(/two options/i);
    expect(choicesProblem({ options: ["a", "b"], correct: [], multiple: false, explanations: [] })).toMatch(/correct/i);
    expect(choicesProblem({ options: ["a", "b"], correct: [0, 1], multiple: false, explanations: [] })).toMatch(/one correct/i);
    expect(choicesProblem({ options: ["a", "b"], correct: [0, 1], multiple: true, explanations: [] })).toBeNull();
    expect(choicesProblem({ options: ["a", "b"], correct: [2], multiple: false, explanations: [] })).toMatch(/one of the options/i);
  });

  it("limits an explanation to 1000 characters", () => {
    const base = { options: ["a", "b"], correct: [0], multiple: false };
    expect(choicesProblem({ ...base, explanations: ["x".repeat(1000), ""] })).toBeNull();
    expect(choicesProblem({ ...base, explanations: ["", "x".repeat(1001)] })).toMatch(/1000/);
  });

  it("sends one trimmed entry per option, null for a blank one, or nothing when none was written", () => {
    const base = { options: ["a", "b", "c"], correct: [0], multiple: false };
    expect(explanationsBody({ ...base, explanations: ["", "  because  "] })).toEqual([null, "because", null]);
    expect(explanationsBody({ ...base, explanations: ["", " ", ""] })).toBeUndefined();
    expect(explanationsBody({ ...base, explanations: [] })).toBeUndefined();
  });
});

describe("tags", () => {
  it("writes a tag the way the question bank stores it", () => {
    expect(normalizeTag("  Two Pointers ")).toBe("two-pointers");
    expect(normalizeTag("hash_map")).toBe("hash-map");
    expect(normalizeTag("C++ / STL!")).toBe("c++-stl");
    expect(normalizeTag("---")).toBe("");
    expect(normalizeTag("x".repeat(120)).length).toBe(80);
  });

  it("drops empty and repeated tags, keeping the order", () => {
    expect(cleanTags(["Arrays", "arrays", " ", "Sorting", "ARRAYS"])).toEqual(["arrays", "sorting"]);
  });
});
