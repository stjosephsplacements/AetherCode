import assert from "node:assert/strict";
import { test } from "node:test";
import { mathText, toPlatformMarkdown } from "./format.ts";

test("plain text becomes sections with maths", () => {
  const { markdown, changed } = toPlatformMarkdown(
    `Given an array of n integers, find the sum of a_i.\n\nInput:\nThe first line has n.\nThe second line has n integers.\n\nOutput\nPrint the sum.\n\nConstraints:\n1 <= n <= 10^5\n-10^9 <= a_i <= 10^9\n`,
  );
  assert.equal(changed, true);
  assert.match(markdown, /^Given an array of n integers, find the sum of \$a_\{i\}\$\./);
  assert.match(markdown, /## Input Format\n\nThe first line has n\./);
  assert.match(markdown, /## Output Format\n\nPrint the sum\./);
  assert.match(markdown, /## Constraints\n\n- \$1 \\le n \\le 10\^\{5\}\$\n- \$-10\^\{9\} \\le a_\{i\} \\le 10\^\{9\}\$\n$/);
});

test("it is idempotent: the output converts to itself", () => {
  const once = toPlatformMarkdown("Find x such that x^2 = 49 and x >= 0.\nInput: a number\nOutput: x\nConstraints: 1 <= T <= 100\n").markdown;
  assert.equal(toPlatformMarkdown(once).markdown, once);
  assert.equal(toPlatformMarkdown(once).changed, false);
});

test("code, existing maths and inline code are left alone", () => {
  const source = "Use `a <= b` and $x^2 + y^2 = z^2$ here.\n\n```\nfor i in range(10^5): a_i = 1\n```\n";
  assert.equal(toPlatformMarkdown(source).markdown, source);
});

test("Unicode maths becomes LaTeX", () => {
  assert.match(toPlatformMarkdown("Given 1 ≤ n ≤ 10⁵ and aᵢ ≥ 0.").markdown, /\$1 \\le n \\le 10\^\{5\}\$/);
  assert.match(toPlatformMarkdown("Given aᵢ ≥ 0.").markdown, /\$a_\{i\} \\ge 0\$/);
});

test("square roots and powers", () => {
  assert.match(toPlatformMarkdown("Return sqrt(n) rounded down, where n < 2^31.").markdown, /\$\\sqrt\{n\}\$/);
  assert.match(toPlatformMarkdown("Return sqrt(n) rounded down, where n < 2^31.").markdown, /\$n < 2\^\{31\}\$/);
});

test("prose with hyphens and dashes is not turned into maths", () => {
  const source = "A well-known problem: print the first-in, last-out item - the top.\n";
  assert.equal(toPlatformMarkdown(source).markdown, source);
});

test("option text gets the maths conversion only", () => {
  assert.equal(mathText("O(n^2) time"), "O($n^{2}$) time");
  assert.equal(mathText("a plain answer"), "a plain answer");
});
