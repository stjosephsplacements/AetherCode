import assert from "node:assert/strict";
import { test } from "node:test";
import { pairTestFiles } from "./test-zip.ts";

test("pairs in/out, samples first, natural order, CRLF normalised", () => {
  const { tests, problems } = pairTestFiles({ "hidden/10.in": "a", "hidden/10.out": "b", "hidden/2.in": "c\r\n", "hidden/2.out": "d", "sample/1.in": "e", "sample/1.out": "f" });
  assert.deepEqual(problems, []);
  assert.deepEqual(tests.map((t) => [t.is_sample, t.input]), [[true, "e"], [false, "c\n"], [false, "a"]]);
});

test("supports input01.txt style and reports unmatched files", () => {
  const { tests, problems } = pairTestFiles({ "input01.txt": "1", "output01.txt": "2", "3.in": "x", "__MACOSX/._1.in": "j", "readme.md": "r" });
  assert.equal(tests.length, 1);
  assert.match(problems.join("|"), /3: expected output file is missing/);
  assert.match(problems.join("|"), /Ignored readme\.md/);
});
