import { describe, expect, it } from "vitest";
import { type Details, blankDetails, blankTest, choicesProblem, cleanTags, detailsProblem, marksShare, normalizeTag, prepareTests, slugOf, slugify, summarizeTests, testsProblem, withNewline } from "./model";

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
    expect(choicesProblem({ options: ["a", ""], correct: [0], multiple: false })).toMatch(/two options/i);
    expect(choicesProblem({ options: ["a", "b"], correct: [], multiple: false })).toMatch(/correct/i);
    expect(choicesProblem({ options: ["a", "b"], correct: [0, 1], multiple: false })).toMatch(/one correct/i);
    expect(choicesProblem({ options: ["a", "b"], correct: [0, 1], multiple: true })).toBeNull();
    expect(choicesProblem({ options: ["a", "b"], correct: [2], multiple: false })).toMatch(/one of the options/i);
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

import { parseTestFile } from "./model";

describe("parseTestFile", () => {
  it("reads this editor's own keys", () => {
    const result = parseTestFile(JSON.stringify([{ input: "1", expected_output: "2", sample: true, weight: 3 }]));
    expect(result.tests).toEqual([{ input: "1\n", expected_output: "2\n", sample: true, weight: 3 }]);
  });
  it("reads the exam-app keys, where isHidden is the opposite of sample", () => {
    const result = parseTestFile(JSON.stringify([{ input: "1", output: "2", isHidden: false }, { input: "3", output: "4", isHidden: true }]));
    expect(result.tests?.map((test) => test.sample)).toEqual([true, false]);
    expect(result.tests?.[0]?.weight).toBe(1);
  });
  it("says what is wrong", () => {
    expect(parseTestFile("nope").error).toMatch(/JSON/);
    expect(parseTestFile("{}").error).toMatch(/list/);
    expect(parseTestFile("[]").error).toMatch(/at least one/);
    expect(parseTestFile(JSON.stringify([{ input: "1" }])).error).toMatch(/Test 1/);
  });
});

import { strToU8, zipSync } from "fflate";
import { parseTestZip, testZipTemplate } from "./test-zip";

describe("parseTestZip", () => {
  const zip = (files: Record<string, string>) => parseTestZip(zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)]))));

  it("pairs 1.in with 1.out in natural order and marks sample files", () => {
    const result = zip({ "10.in": "x", "10.out": "y", "2.in": "a", "2.out": "b", "sample-1.in": "s", "sample-1.out": "t" });
    expect(result.tests?.map((test) => [test.input, test.sample])).toEqual([["s\n", true], ["a\n", false], ["x\n", false]]);
  });
  it("pairs input/ and output/ folders by file name", () => {
    const result = zip({ "input/01.txt": "1", "output/01.txt": "2", "input/02.txt": "3", "output/02.txt": "4" });
    expect(result.tests?.map((test) => test.expected_output)).toEqual(["2\n", "4\n"]);
  });
  it("prefers a tests.json inside the zip", () => {
    const result = zip({ "tests.json": JSON.stringify([{ input: "1", expected_output: "2", sample: true }]), "1.in": "z", "1.out": "z" });
    expect(result.tests).toHaveLength(1);
    expect(result.tests?.[0]?.sample).toBe(true);
  });
  it("says which file is unpaired", () => {
    expect(zip({ "1.in": "a" }).error).toMatch(/1\.in has no matching output/);
    expect(zip({ "1.out": "a", "2.in": "b", "2.out": "c" }).error).toMatch(/1\.out has no matching input/);
  });
  it("ignores mac metadata and rejects non-zips and empty zips", () => {
    expect(zip({ "__MACOSX/._1.in": "junk", "1.in": "a", "1.out": "b" }).tests).toHaveLength(1);
    expect(parseTestZip(strToU8("not a zip")).error).toMatch(/zip/);
    expect(zip({ "readme.md": "hi" }).error).toMatch(/No input files/);
  });
  it("reads its own template", () => {
    expect(parseTestZip(testZipTemplate()).tests?.map((test) => test.sample)).toEqual([true, false]);
  });
});
