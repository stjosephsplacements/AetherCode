import { LANGUAGES, type LanguageId } from "./languages.ts";

export type ExecStatus = "ok" | "compile_error" | "runtime_error" | "time_limit" | "memory_limit" | "internal_error";

export interface ExecResult {
  status: ExecStatus;
  stdout: string;
  stderr: string;
  timeMs: number | null;
  memoryKb: number | null;
}

export type BatchResult = { compileError: string } | { results: ExecResult[] };

interface EngineTest {
  test_index: number;
  verdict: string;
  cpu_time_ns: number;
  memory_bytes: number;
  stdout?: string;
  stderr?: string;
  stdout_preview?: string;
  stderr_preview?: string;
}

interface Verdict {
  verdict: string;
  compile_stderr?: string;
  results?: EngineTest[];
}

const STATUS: Record<string, ExecStatus> = {
  accepted: "ok",
  wrong_answer: "ok",
  compilation_error: "compile_error",
  time_limit: "time_limit",
  memory_limit: "memory_limit",
  output_limit: "runtime_error",
  runtime_error: "runtime_error",
};

const MISSING: ExecResult = { status: "internal_error", stdout: "", stderr: "", timeMs: null, memoryKb: null };

function engineUrl(): string {
  const url = process.env.ENGINE_URL;
  if (!url) throw new Error("ENGINE_URL is required");
  return url.replace(/\/+$/, "");
}

/**
 * Runs one program on every input in the hosted AetherCode Execution Engine (the same engine the
 * platform judge uses): it compiles once and streams one verdict. Output is compared by the caller.
 */
export async function runBatch(input: { language: LanguageId; source: string; inputs: string[]; timeLimitMs: number; memoryLimitKb: number }): Promise<BatchResult> {
  const timeLimitMs = Math.min(20_000, Math.max(100, Math.round(input.timeLimitMs * LANGUAGES[input.language].timeMultiplier)));
  const body = JSON.stringify({
    language: input.language,
    source_code: input.source,
    mode: "run",
    tests: input.inputs.map((stdin) => ({ input: stdin, expected_output: "" })),
    time_limit_ms: timeLimitMs,
    memory_limit_kb: Math.min(2_097_152, Math.max(16_384, input.memoryLimitKb)),
  });
  const base = engineUrl();
  let delay = 1500;
  for (let attempt = 0; ; attempt++) {
    const created = await fetch(`${base}/api/v1/execute`, { method: "POST", headers: { "content-type": "application/json" }, body });
    if (created.status === 429 && attempt < 6) {
      await new Promise((resolve) => setTimeout(resolve, delay + Math.random() * 500));
      delay = Math.min(delay * 2, 15_000);
      continue;
    }
    if (!created.ok) throw new Error(`the judge refused the run (${created.status})`);
    const { job_id: jobId, stream_token: streamToken } = (await created.json()) as { job_id: string; stream_token?: string };
    const verdict = await awaitVerdict(base, jobId, streamToken);
    if (verdict.verdict === "compilation_error") return { compileError: verdict.compile_stderr ?? "compilation failed" };
    const byIndex = new Map((verdict.results ?? []).map((test) => [test.test_index, test]));
    return {
      results: input.inputs.map((_, index) => {
        const test = byIndex.get(index);
        return test
          ? {
              status: STATUS[test.verdict] ?? "internal_error",
              stdout: test.stdout ?? test.stdout_preview ?? "",
              stderr: test.stderr ?? test.stderr_preview ?? "",
              timeMs: Math.round(test.cpu_time_ns / 1_000_000),
              memoryKb: Math.round(test.memory_bytes / 1024),
            }
          : MISSING;
      }),
    };
  }
}

async function awaitVerdict(base: string, jobId: string, streamToken?: string): Promise<Verdict> {
  const token = streamToken ? `&stream_token=${encodeURIComponent(streamToken)}` : "";
  const response = await fetch(`${base}/api/v1/stream?job_id=${encodeURIComponent(jobId)}${token}`, {
    headers: { accept: "text/event-stream" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) throw new Error(`the judge stream failed (${response.status})`);
  const verdict = await readVerdict(response.body);
  if (!verdict) throw new Error("the judge ended without a verdict");
  return verdict;
}

/** Reads server-sent events until the VERDICT event; one event can arrive split across reads. */
export async function readVerdict(body: ReadableStream<Uint8Array>): Promise<Verdict | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "";
  let data: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (line === "") {
          if (event === "VERDICT" && data.length > 0) return (JSON.parse(data.join("\n")) as { data: Verdict }).data;
          event = "";
          data = [];
        } else if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (done) return null;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
