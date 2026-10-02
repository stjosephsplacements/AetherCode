import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { batchFiles, batchStatus, JUDGE0_TOOLCHAIN, parseBatchOutput, zip } from "./batch.ts";

const b64 = (value: string) => Buffer.from(value).toString("base64");

test("parseBatchOutput reads framed records and leaves missing tests null", () => {
  const stdout = [
    "noise from the script",
    `@@AETHER 0 0 12`,
    b64("15\n"),
    "",
    `@@AETHER 2 137 2100`,
    "",
    b64("Killed"),
    "",
  ].join("\n");
  const results = parseBatchOutput(stdout, 3);
  assert.deepEqual(results[0], { exitCode: 0, wallMs: 12, stdout: "15\n", stderr: "" });
  assert.equal(results[1], null);
  assert.deepEqual(results[2], { exitCode: 137, wallMs: 2100, stdout: "", stderr: "Killed" });
});

test("parseBatchOutput ignores out-of-range indices", () => {
  assert.deepEqual(parseBatchOutput(`@@AETHER 5 0 1\n\n\n`, 2), [null, null]);
});

test("batchStatus", () => {
  const cases: Array<[number, number, string]> = [
    [0, 10, "ok"],
    [1, 10, "runtime_error"],
    [152, 900, "time_limit"],
    [137, 2500, "time_limit"],
    [137, 50, "runtime_error"],
  ];
  for (const [exitCode, wallMs, want] of cases) {
    assert.equal(batchStatus({ exitCode, wallMs, stdout: "", stderr: "" }, 2000), want, `${exitCode}/${wallMs}`);
  }
});

test("batchFiles lays out source, scripts and one input file per test", () => {
  const files = batchFiles({ language: "c", source: "int main(){}", inputs: ["1\n", "2\n"], timeLimitMs: 1500 }, JUDGE0_TOOLCHAIN);
  assert.deepEqual(Object.keys(files).sort(), ["compile", "main.c", "run", "tests/0.in", "tests/1.in"]);
  assert.match(files.run, /seq 0 1/);
  assert.match(files.run, /ulimit -t 2/);
  const python = batchFiles({ language: "python", source: "", inputs: ["x"], timeLimitMs: 1000 }, JUDGE0_TOOLCHAIN);
  assert.equal(python.compile, undefined);
});

test("zip round-trips through the system unzip", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "zip-"));
  const files = { "main.c": "int main(){}\n", "tests/0.in": "héllo\n".repeat(1000), run: "#!/bin/bash\necho hi\n" };
  writeFileSync(path.join(dir, "a.zip"), zip(files));
  execFileSync("unzip", ["-q", "a.zip"], { cwd: dir });
  for (const [name, content] of Object.entries(files)) assert.equal(readFileSync(path.join(dir, name), "utf8"), content);
});
