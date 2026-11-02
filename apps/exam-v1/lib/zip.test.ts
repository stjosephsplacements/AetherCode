import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zip } from "./zip.ts";

test("zip round-trips through the system unzip", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "zip-"));
  const files = { "main.c": "int main(){}\n", "tests/0.in": "héllo\n".repeat(1000), run: "#!/bin/bash\necho hi\n" };
  writeFileSync(path.join(dir, "a.zip"), zip(files));
  execFileSync("unzip", ["-q", "a.zip"], { cwd: dir });
  for (const [name, content] of Object.entries(files)) assert.equal(readFileSync(path.join(dir, name), "utf8"), content);
});
