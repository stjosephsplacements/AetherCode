import { test } from "node:test";
import assert from "node:assert/strict";
import { mcqCorrect, optionOrder, validSelection } from "./mcq.ts";

test("optionOrder is a stable permutation that varies by seed", () => {
  const order = optionOrder(5, "attempt-1:q");
  assert.deepEqual([...order].sort(), [0, 1, 2, 3, 4]);
  assert.deepEqual(optionOrder(5, "attempt-1:q"), order);
  const distinct = new Set(Array.from({ length: 30 }, (_, index) => optionOrder(5, `attempt-${index}:q`).join("")));
  assert.ok(distinct.size > 10, `only ${distinct.size} distinct orders`);
});

test("mcqCorrect is all-or-nothing and order-insensitive", () => {
  const cases: Array<[number[], number[], boolean]> = [
    [[2], [2], true],
    [[1], [2], false],
    [[], [2], false],
    [[3, 1], [1, 3], true],
    [[1], [1, 3], false],
    [[1, 3, 4], [1, 3], false],
  ];
  for (const [selected, correct, want] of cases) assert.equal(mcqCorrect(selected, correct), want, `${selected} vs ${correct}`);
});

test("validSelection", () => {
  assert.equal(validSelection([0], 4, false), true);
  assert.equal(validSelection([], 4, false), true);
  assert.equal(validSelection([0, 1], 4, false), false);
  assert.equal(validSelection([0, 1], 4, true), true);
  assert.equal(validSelection([4], 4, true), false);
  assert.equal(validSelection([1, 1], 4, true), false);
  assert.equal(validSelection([-1], 4, true), false);
});
