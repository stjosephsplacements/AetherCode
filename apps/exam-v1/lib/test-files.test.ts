import { test } from "node:test";
import assert from "node:assert/strict";
import { zip } from "./batch.ts";
import { pairTestFiles, readZip } from "./test-files.ts";

test("pairTestFiles matches common naming schemes and reports leftovers", () => {
  const { tests, unmatched } = pairTestFiles([
    { path: "input/input00.txt", content: "5\n" },
    { path: "output/output00.txt", content: "15\n" },
    { path: "2.in", content: "2\n" },
    { path: "2.out", content: "3\n" },
    { path: "input1.txt", content: "1\n" },
    { path: "output1.txt", content: "1\n" },
    { path: "3.in", content: "orphan" },
    { path: "README.md", content: "" },
  ]);
  assert.deepEqual(
    tests.map((entry) => [entry.name, entry.input, entry.expectedOutput]),
    [
      ["0", "5\n", "15\n"],
      ["1", "1\n", "1\n"],
      ["2", "2\n", "3\n"],
    ],
  );
  assert.deepEqual(unmatched.sort(), ["README.md", "test 3 (missing output)"]);
});

test("readZip reads archives written by our zip writer", async () => {
  const archive = zip({ "input/input00.txt": "5\n".repeat(500), "output/output00.txt": "15\n" });
  const buffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
  const files = await readZip(buffer);
  assert.deepEqual(
    files.map((file) => [file.path, file.content.length]),
    [
      ["input/input00.txt", 1000],
      ["output/output00.txt", 3],
    ],
  );
});
