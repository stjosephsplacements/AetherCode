import { test } from "node:test";
import assert from "node:assert/strict";
import { outputsMatch } from "./compare.ts";

test("outputsMatch", () => {
  const cases: Array<[string, string, string, boolean]> = [
    ["identical", "1 2\n3", "1 2\n3", true],
    ["trailing newline", "42\n", "42", true],
    ["crlf", "a\r\nb\r\n", "a\nb", true],
    ["trailing spaces per line", "a  \nb\t\n", "a\nb", true],
    ["leading space differs", " a", "a", false],
    ["inner space differs", "1  2", "1 2", false],
    ["different value", "41", "42", false],
    ["missing line", "a", "a\nb", false],
  ];
  for (const [name, actual, expected, want] of cases) {
    assert.equal(outputsMatch(actual, expected), want, name);
  }
});
