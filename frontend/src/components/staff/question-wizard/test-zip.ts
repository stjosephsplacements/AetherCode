import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { MAX_UPLOADED_TESTS, type TestDraft, parseTestFile, prepareTests } from "./model";

const MAX_ENTRY_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = MAX_UPLOADED_TESTS * 2 + 20;

const INPUT = new Set(["in", "input", "inp"]);
const OUTPUT = new Set(["out", "output", "ans", "answer", "expected", "sol", "a"]);
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

type Failure = { tests?: undefined; error: string };
type Success = { tests: TestDraft[]; error?: undefined };

/** The file name without its folders, and its extension in lower case. */
const split = (path: string) => {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return { name, stem: dot > 0 ? name.slice(0, dot) : name, ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : "" };
};

/**
 * Turns the files of a zip into tests. A `tests.json` (the JSON upload format) wins when present.
 * Otherwise files pair up by name: `1.in` with `1.out`, or `input/01.txt` with `output/01.txt`.
 * A name containing "sample" or "example" marks a sample test; everything else is hidden.
 */
export function testsFromFiles(files: Record<string, Uint8Array>): Success | Failure {
  const paths = Object.keys(files).filter((path) => !path.endsWith("/") && !path.startsWith("__MACOSX/") && !split(path).name.startsWith("."));
  if (paths.length === 0) return { error: "The zip has no files in it." };

  const manifest = paths.find((path) => split(path).name.toLowerCase() === "tests.json");
  if (manifest) return parseTestFile(strFromU8(files[manifest]!));

  const inputs = new Map<string, string>();
  const outputs = new Map<string, string>();
  for (const path of paths) {
    const { stem, ext } = split(path);
    const folder = path.toLowerCase().split("/").slice(0, -1);
    const key = `${folder.filter((part) => part !== "input" && part !== "inputs" && part !== "output" && part !== "outputs" && part !== "in" && part !== "out").join("/")}/${stem}`;
    const inInput = folder.some((part) => part === "input" || part === "inputs" || part === "in");
    const inOutput = folder.some((part) => part === "output" || part === "outputs" || part === "out");
    if (INPUT.has(ext) || (inInput && !inOutput)) inputs.set(key, path);
    else if (OUTPUT.has(ext) || (inOutput && !inInput)) outputs.set(key, path);
  }
  if (inputs.size === 0) return { error: "No input files found. Name them 1.in with 1.out, or put them in input/ and output/ folders." };
  const missing = [...inputs.keys()].find((key) => !outputs.has(key));
  if (missing) return { error: `${split(inputs.get(missing)!).name} has no matching output file.` };
  const orphan = [...outputs.keys()].find((key) => !inputs.has(key));
  if (orphan) return { error: `${split(outputs.get(orphan)!).name} has no matching input file.` };
  if (inputs.size > MAX_UPLOADED_TESTS) return { error: `At most ${MAX_UPLOADED_TESTS} tests can be uploaded at once.` };

  const isSample = (key: string) => /sample|example/i.test(inputs.get(key)!);
  const tests = [...inputs.keys()].sort((a, b) => Number(isSample(b)) - Number(isSample(a)) || natural(a, b)).map((key): TestDraft => {
    const path = inputs.get(key)!;
    return {
      input: strFromU8(files[path]!),
      expected_output: strFromU8(files[outputs.get(key)!]!),
      sample: isSample(key),
      weight: 1,
    };
  });
  return { tests: prepareTests(tests) };
}

/** Reads a zip file, refusing one that would unpack to more than a test file should. */
export function parseTestZip(bytes: Uint8Array): Success | Failure {
  let total = 0;
  let entries = 0;
  let tooBig: string | null = null;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(file) {
        if (file.name.endsWith("/")) return false;
        entries++;
        total += file.originalSize;
        if (file.originalSize > MAX_ENTRY_BYTES) tooBig = `${split(file.name).name} is larger than 1 MB.`;
        return !tooBig && entries <= MAX_ENTRIES && total <= MAX_TOTAL_BYTES;
      },
    });
  } catch {
    return { error: "That file is not a readable zip." };
  }
  if (tooBig) return { error: tooBig };
  if (entries > MAX_ENTRIES) return { error: "The zip has too many files." };
  if (total > MAX_TOTAL_BYTES) return { error: "The zip unpacks to more than 32 MB." };
  return testsFromFiles(files);
}

/** What the "Template" button downloads: a sample pair and a hidden pair, named the way the reader expects. */
export function testZipTemplate(): Uint8Array {
  return zipSync({
    "sample-1.in": strToU8("1\n2\n"),
    "sample-1.out": strToU8("3\n"),
    "2.in": strToU8("10\n20\n"),
    "2.out": strToU8("30\n"),
  });
}
