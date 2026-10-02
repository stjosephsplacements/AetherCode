import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv } from "./csv.ts";

test("csvCell neutralises formulas and quotes separators", () => {
  const cases: Array<[string, string]> = [
    ["Asha", "Asha"],
    ["=HYPERLINK(\"http://x\")", "\"'=HYPERLINK(\"\"http://x\"\")\""],
    ["+91 98", "'+91 98"],
    ["-5", "'-5"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["a,b", "\"a,b\""],
    ["line\nbreak", "\"line\nbreak\""],
  ];
  for (const [input, want] of cases) assert.equal(csvCell(input), want, input);
});

test("toCsv joins rows with CRLF", () => {
  assert.equal(toCsv([["a", "b"], ["1", "2"]]), "a,b\r\n1,2");
});
