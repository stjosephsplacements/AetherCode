// Compile-once batches: one sandbox job compiles the program, then a generated
// `run` script executes it against each input with its own CPU limit and prints
// one framed, base64-encoded record per test. Used with Judge0's multi-file
// program mode, where all compilers live in the same sandbox.
import { deflateRawSync } from "node:zlib";
import { LANGUAGES, type LanguageId } from "./languages.ts";

export interface Toolchain {
  compile?: string;
  run: string;
}

// Paths inside the judge0/judge0:1.13.1 image (its own language definitions).
export const JUDGE0_TOOLCHAIN: Record<LanguageId, Toolchain> = {
  c: { compile: "/usr/local/gcc-9.2.0/bin/gcc -O2 -std=gnu11 -o a.out main.c -lm", run: "./a.out" },
  cpp: {
    compile: "/usr/local/gcc-9.2.0/bin/g++ -O2 -std=gnu++17 -o a.out main.cpp",
    run: "env LD_LIBRARY_PATH=/usr/local/gcc-9.2.0/lib64 ./a.out",
  },
  java: { compile: "/usr/local/openjdk13/bin/javac Main.java", run: "/usr/local/openjdk13/bin/java -Xss64m Main" },
  python: { run: "/usr/local/python-3.8.1/bin/python3 main.py" },
};

export const OUTPUT_LIMIT_BYTES = 262_144;
const STDERR_LIMIT_BYTES = 16_384;
const MARK = "@@AETHER";

export interface BatchRequest {
  language: LanguageId;
  source: string;
  inputs: string[];
  timeLimitMs: number;
}

export interface BatchTestResult {
  exitCode: number;
  wallMs: number;
  stdout: string;
  stderr: string;
}

export function batchFiles(request: BatchRequest, toolchain: Record<LanguageId, Toolchain>): Record<string, string> {
  const language = LANGUAGES[request.language];
  const tools = toolchain[request.language];
  const limitMs = request.timeLimitMs * language.timeMultiplier;
  const cpuSeconds = Math.max(1, Math.ceil(limitMs / 1000));
  const wallSeconds = Math.ceil((limitMs * 3) / 1000) + 2;
  const files: Record<string, string> = {
    [language.fileName]: request.source,
    run: [
      "#!/bin/bash",
      "mkdir -p .out",
      `for i in $(seq 0 ${request.inputs.length - 1}); do`,
      "  started=$(date +%s%N)",
      `  ( ulimit -t ${cpuSeconds}; exec timeout -s KILL ${wallSeconds} ${tools.run} ) < tests/$i.in > .out/stdout 2> .out/stderr`,
      "  code=$?",
      "  ended=$(date +%s%N)",
      `  echo "${MARK} $i $code $(( (ended - started) / 1000000 ))"`,
      `  head -c ${OUTPUT_LIMIT_BYTES} .out/stdout | base64 -w0; echo`,
      `  head -c ${STDERR_LIMIT_BYTES} .out/stderr | base64 -w0; echo`,
      "done",
      "",
    ].join("\n"),
  };
  if (tools.compile) files.compile = `#!/bin/bash\n${tools.compile}\n`;
  request.inputs.forEach((input, index) => {
    files[`tests/${index}.in`] = input;
  });
  return files;
}

// Missing entries mean the run script was stopped before reaching that test.
export function parseBatchOutput(stdout: string, count: number): Array<BatchTestResult | null> {
  const results: Array<BatchTestResult | null> = Array.from({ length: count }, () => null);
  const lines = stdout.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const header = lines[index].split(" ");
    if (header[0] !== MARK || header.length !== 4) continue;
    const test = Number(header[1]);
    if (!Number.isInteger(test) || test < 0 || test >= count || index + 2 >= lines.length) continue;
    results[test] = {
      exitCode: Number(header[2]),
      wallMs: Number(header[3]),
      stdout: Buffer.from(lines[index + 1], "base64").toString("utf8"),
      stderr: Buffer.from(lines[index + 2], "base64").toString("utf8"),
    };
    index += 2;
  }
  return results;
}

// SIGKILL (137) after using most of the budget, or SIGXCPU (152), is a time limit;
// an early SIGKILL is the sandbox's memory limit.
export function batchStatus(result: BatchTestResult, limitMs: number): "ok" | "time_limit" | "runtime_error" {
  if (result.exitCode === 0) return "ok";
  if (result.exitCode === 152) return "time_limit";
  if (result.exitCode === 137) return result.wallMs >= limitMs ? "time_limit" : "runtime_error";
  return "runtime_error";
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Minimal deflate ZIP writer: enough for Judge0's additional_files.
export function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    // Unix mode 0755 so the scripts are executable after extraction.
    central.writeUInt32LE((0o100755 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, compressed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
