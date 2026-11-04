import type { TestDraft } from "./draft.ts";

const INPUT_EXT = new Set(["in", "input"]);
const OUTPUT_EXT = new Set(["out", "ans", "output", "a"]);
export const MAX_FILE_BYTES = 100_000;
export const MAX_TESTS = 200;

export type ZipImport = { tests: TestDraft[]; problems: string[] };

const natural = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/** Pairs `N.in` with `N.out` (also `.ans`, `input01.txt` with `output01.txt`). Files under a `sample` folder are samples; the rest are hidden. */
export function pairTestFiles(files: Record<string, string>): ZipImport {
  const problems: string[] = [];
  const slots = new Map<string, { input?: string; output?: string; sample: boolean }>();
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split("/").filter(Boolean);
    const file = parts.at(-1) ?? "";
    if (parts.includes("__MACOSX") || file.startsWith(".") || file.startsWith("._")) continue;
    const dir = parts.slice(0, -1);
    const dot = file.lastIndexOf(".");
    const stem = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : "";
    let role: "input" | "output" | null = null;
    let key = stem;
    if (INPUT_EXT.has(ext)) role = "input";
    else if (OUTPUT_EXT.has(ext)) role = "output";
    else if (ext === "txt" && /^input/i.test(stem)) { role = "input"; key = stem.replace(/^input[-_ ]?/i, ""); }
    else if (ext === "txt" && /^output/i.test(stem)) { role = "output"; key = stem.replace(/^output[-_ ]?/i, ""); }
    if (!role) { problems.push(`Ignored ${path}: not an input or output file.`); continue; }
    const id = [...dir, key].join("/");
    const slot = slots.get(id) ?? { sample: dir.some((part) => /^samples?$/i.test(part)) };
    slot[role] = content.replace(/\r\n?/g, "\n");
    slots.set(id, slot);
  }
  const ids = [...slots.keys()].sort((a, b) => Number(slots.get(b)!.sample) - Number(slots.get(a)!.sample) || natural(a, b));
  const tests: TestDraft[] = [];
  for (const id of ids) {
    const slot = slots.get(id)!;
    if (slot.input === undefined || slot.output === undefined) { problems.push(`${id}: ${slot.input === undefined ? "input" : "expected output"} file is missing.`); continue; }
    if (slot.output.trim() === "") { problems.push(`${id}: expected output is empty.`); continue; }
    tests.push({ input: slot.input, expected_output: slot.output, is_sample: slot.sample, weight: 1 });
  }
  if (tests.length > MAX_TESTS) { problems.push(`Only the first ${MAX_TESTS} tests are kept.`); tests.length = MAX_TESTS; }
  return { tests, problems };
}
