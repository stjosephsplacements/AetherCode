import { batchFiles, batchStatus, JUDGE0_TOOLCHAIN, parseBatchOutput, zip } from "./batch.ts";
import { LANGUAGES, type LanguageId } from "./languages.ts";

export type ExecStatus = "ok" | "compile_error" | "runtime_error" | "time_limit" | "memory_limit" | "internal_error";

export interface ExecRequest {
  language: LanguageId;
  source: string;
  stdin: string;
  timeLimitMs: number;
  memoryLimitKb: number;
}

export interface ExecResult {
  status: ExecStatus;
  stdout: string;
  stderr: string;
  compileOutput: string;
  timeMs: number | null;
  memoryKb: number | null;
}

export interface BatchExecRequest {
  language: LanguageId;
  source: string;
  inputs: string[];
  timeLimitMs: number;
  memoryLimitKb: number;
}

// Either the program did not compile, or one result per input, in order.
export type BatchExecResult = { compileError: string } | { results: ExecResult[] };

export interface Engine {
  execute(request: ExecRequest): Promise<ExecResult>;
  // Engines that can compile once and run many inputs implement this.
  executeBatch?(request: BatchExecRequest): Promise<BatchExecResult>;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer, got: ${raw}`);
  return value;
}

export function engineFromEnv(): Engine {
  const url = process.env.ENGINE_URL;
  if (!url) throw new Error("ENGINE_URL is required");
  const kind = process.env.ENGINE ?? "judge0";
  if (kind === "judge0") return new Judge0Engine(url, process.env.ENGINE_AUTH_TOKEN ?? "", process.env.ENGINE_BATCH !== "false");
  if (kind === "piston") return new PistonEngine(url);
  if (kind === "aethercode") return new AetherCodeEngine(url);
  throw new Error(`unknown ENGINE ${kind}`);
}

// ---------------------------------------------------------------------------
// Judge0
// ---------------------------------------------------------------------------

// These are Judge0 API status IDs — part of the protocol, not operational config.
const JUDGE0_STATUS_ACCEPTED = 3;
const JUDGE0_STATUS_TLE = 5;
const JUDGE0_STATUS_COMPILE_ERROR = 6;
const JUDGE0_STATUS_RUNTIME_ERROR_FIRST = 7;
const JUDGE0_STATUS_RUNTIME_ERROR_LAST = 12;
const JUDGE0_MULTI_FILE_LANGUAGE_ID = 89;

// Piston runs Java as `java Main.java`, which compiles inside the timed run.
const PISTON_JAVA_COMPILE_ALLOWANCE_MS = 3000;

interface Judge0Submission {
  status?: { id: number; description: string };
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  message?: string | null;
  time?: string | null;
  memory?: number | null;
}

export class Judge0Engine implements Engine {
  readonly executeBatch?: (request: BatchExecRequest) => Promise<BatchExecResult>;

  // Operational limits — all tunable via env without redeploying.
  // Must stay within MAX_CPU_TIME_LIMIT / MAX_WALL_TIME_LIMIT in deploy/judge0.conf.
  private readonly pollIntervalMs: number;
  private readonly pollDeadlineMs: number;
  private readonly batchCpuBudgetSeconds: number;
  private readonly batchWallBudgetSeconds: number;
  private readonly maxCpuSeconds: number;
  private readonly maxMemoryKb: number;

  constructor(
    private readonly baseUrl: string,
    private readonly authToken: string,
    batching: boolean,
  ) {
    this.pollIntervalMs = envInt("ENGINE_JUDGE0_POLL_INTERVAL_MS", 400);
    this.pollDeadlineMs = envInt("ENGINE_JUDGE0_POLL_DEADLINE_MS", 120_000);
    this.batchCpuBudgetSeconds = envInt("ENGINE_JUDGE0_BATCH_CPU_BUDGET_SECONDS", 100);
    this.batchWallBudgetSeconds = envInt("ENGINE_JUDGE0_BATCH_WALL_BUDGET_SECONDS", 200);
    this.maxCpuSeconds = envInt("ENGINE_JUDGE0_MAX_CPU_SECONDS", 15);
    this.maxMemoryKb = envInt("ENGINE_JUDGE0_MAX_MEMORY_KB", 512_000);
    if (batching) this.executeBatch = (request) => this.batch(request);
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.authToken) headers["x-auth-token"] = this.authToken;
    return headers;
  }

  private async run(body: Record<string, unknown>): Promise<Judge0Submission & { statusId: number }> {
    const created = await fetch(`${this.baseUrl}/submissions?base64_encoded=true&wait=false`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!created.ok) throw new Error(`judge0 create failed: ${created.status} ${await created.text()}`);
    const { token } = (await created.json()) as { token: string };

    const deadline = Date.now() + this.pollDeadlineMs + this.batchWallBudgetSeconds * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
      const response = await fetch(
        `${this.baseUrl}/submissions/${token}?base64_encoded=true&fields=status,stdout,stderr,compile_output,message,time,memory`,
        { headers: this.headers() },
      );
      if (!response.ok) throw new Error(`judge0 poll failed: ${response.status}`);
      const submission = (await response.json()) as Judge0Submission;
      const statusId = submission.status?.id ?? 0;
      if (statusId > 2) return { ...submission, statusId };
    }
    throw new Error("judge0 result did not arrive in time");
  }

  async execute(request: ExecRequest): Promise<ExecResult> {
    const language = LANGUAGES[request.language];
    const cpuSeconds = Math.min(this.maxCpuSeconds, (request.timeLimitMs * language.timeMultiplier) / 1000);
    const submission = await this.run({
      language_id: language.judge0Id,
      source_code: b64(request.source),
      stdin: b64(request.stdin),
      cpu_time_limit: cpuSeconds,
      wall_time_limit: Math.min(this.maxCpuSeconds * 2, cpuSeconds * 3 + 2),
      memory_limit: Math.min(this.maxMemoryKb, request.memoryLimitKb),
    });
    return {
      status: judge0Status(submission.statusId),
      stdout: unb64(submission.stdout),
      stderr: unb64(submission.stderr) || unb64(submission.message),
      compileOutput: unb64(submission.compile_output),
      timeMs: submission.time ? Math.round(Number(submission.time) * 1000) : null,
      memoryKb: submission.memory ?? null,
    };
  }

  // Splits the inputs into chunks whose combined CPU budget fits one Judge0 job.
  private async batch(request: BatchExecRequest): Promise<BatchExecResult> {
    const limitMs = request.timeLimitMs * LANGUAGES[request.language].timeMultiplier;
    const perTestSeconds = Math.max(1, Math.ceil(limitMs / 1000));
    const chunkSize = Math.max(1, Math.floor(this.batchCpuBudgetSeconds / perTestSeconds));
    const chunks: string[][] = [];
    for (let index = 0; index < request.inputs.length; index += chunkSize) chunks.push(request.inputs.slice(index, index + chunkSize));

    const outcomes = await Promise.all(
      chunks.map(async (inputs) => {
        const archive = zip(batchFiles({ language: request.language, source: request.source, inputs, timeLimitMs: request.timeLimitMs }, JUDGE0_TOOLCHAIN));
        const cpuBudget = Math.min(this.batchCpuBudgetSeconds + 10, inputs.length * perTestSeconds + 5);
        const submission = await this.run({
          language_id: JUDGE0_MULTI_FILE_LANGUAGE_ID,
          additional_files: archive.toString("base64"),
          cpu_time_limit: cpuBudget,
          wall_time_limit: Math.min(this.batchWallBudgetSeconds, cpuBudget * 2 + 10),
          memory_limit: Math.min(this.maxMemoryKb, request.memoryLimitKb),
          max_file_size: 8192,
        });
        return { inputs, submission };
      }),
    );

    const results: ExecResult[] = [];
    for (const { inputs, submission } of outcomes) {
      if (submission.statusId === JUDGE0_STATUS_COMPILE_ERROR) return { compileError: unb64(submission.compile_output) };
      const parsed = parseBatchOutput(unb64(submission.stdout), inputs.length);
      for (const entry of parsed) {
        if (!entry) {
          // The whole job hit its budget before reaching this test.
          const status: ExecStatus = submission.statusId === JUDGE0_STATUS_TLE ? "time_limit" : "internal_error";
          results.push({ status, stdout: "", stderr: unb64(submission.message), compileOutput: "", timeMs: null, memoryKb: null });
          continue;
        }
        results.push({
          status: batchStatus(entry, limitMs),
          stdout: entry.stdout,
          stderr: entry.stderr,
          compileOutput: "",
          timeMs: entry.wallMs,
          memoryKb: null,
        });
      }
    }
    return { results };
  }
}

function judge0Status(id: number): ExecStatus {
  if (id === JUDGE0_STATUS_ACCEPTED) return "ok";
  if (id === JUDGE0_STATUS_TLE) return "time_limit";
  if (id === JUDGE0_STATUS_COMPILE_ERROR) return "compile_error";
  if (id >= JUDGE0_STATUS_RUNTIME_ERROR_FIRST && id <= JUDGE0_STATUS_RUNTIME_ERROR_LAST) return "runtime_error";
  return "internal_error";
}

// ---------------------------------------------------------------------------
// Piston
// ---------------------------------------------------------------------------

interface PistonStage {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
  status?: string | null;
  message?: string | null;
  cpu_time?: number;
  wall_time?: number;
  memory?: number;
}

export class PistonEngine implements Engine {
  constructor(private readonly baseUrl: string) {}

  async execute(request: ExecRequest): Promise<ExecResult> {
    const language = LANGUAGES[request.language];
    const response = await fetch(`${this.baseUrl}/api/v2/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        language: language.pistonName,
        version: "*",
        files: [{ name: language.fileName, content: request.source }],
        stdin: request.stdin,
        compile_timeout: 10_000,
        run_timeout:
          request.timeLimitMs * language.timeMultiplier + (request.language === "java" ? PISTON_JAVA_COMPILE_ALLOWANCE_MS : 0),
        run_memory_limit: request.memoryLimitKb * 1024,
      }),
    });
    if (!response.ok) throw new Error(`piston execute failed: ${response.status} ${await response.text()}`);
    const body = (await response.json()) as { compile?: PistonStage; run: PistonStage };
    if (body.compile && body.compile.code !== 0) {
      return {
        status: "compile_error",
        stdout: "",
        stderr: "",
        compileOutput: body.compile.stderr || body.compile.stdout,
        timeMs: null,
        memoryKb: null,
      };
    }
    const run = body.run;
    if (request.language === "java" && run.code !== 0 && /error: compilation failed/.test(run.stderr)) {
      return { status: "compile_error", stdout: "", stderr: "", compileOutput: run.stderr, timeMs: null, memoryKb: null };
    }
    let status: ExecStatus = "ok";
    // Piston kills over-limit processes with SIGKILL and marks timeouts "TO".
    if (run.status === "TO" || run.signal === "SIGKILL") status = "time_limit";
    else if (run.code !== 0 || run.signal) status = "runtime_error";
    return {
      status,
      stdout: run.stdout,
      stderr: run.stderr,
      compileOutput: "",
      timeMs: run.cpu_time ?? run.wall_time ?? null,
      memoryKb: run.memory ? Math.round(run.memory / 1024) : null,
    };
  }
}

// ---------------------------------------------------------------------------
// AetherCode Execution Engine (go-judge backed, results over SSE)
// ---------------------------------------------------------------------------

interface AetherCodeTestResult {
  test_index: number;
  verdict: string;
  cpu_time_ns: number;
  memory_bytes: number;
  // Complete output in run mode; previews are cut to 256 bytes.
  stdout?: string;
  stderr?: string;
  stdout_preview?: string;
  stderr_preview?: string;
}

interface AetherCodeVerdictData {
  verdict: string;
  compile_stderr?: string;
  results?: AetherCodeTestResult[];
  cpu_time_ns?: number;
  memory_bytes?: number;
}

const toResult = (test: AetherCodeTestResult): ExecResult => ({
  status: acVerdict(test.verdict),
  stdout: test.stdout ?? test.stdout_preview ?? "",
  stderr: test.stderr ?? test.stderr_preview ?? "",
  compileOutput: "",
  timeMs: Math.round(test.cpu_time_ns / 1_000_000),
  memoryKb: Math.round(test.memory_bytes / 1024),
});

const MISSING: ExecResult = { status: "internal_error", stdout: "", stderr: "", compileOutput: "", timeMs: null, memoryKb: null };

export class AetherCodeEngine implements Engine {
  private readonly streamTimeoutMs: number;
  private readonly maxTimeLimitMs: number;
  private readonly minTimeLimitMs: number;
  private readonly maxMemoryLimitKb: number;
  private readonly minMemoryLimitKb: number;
  private readonly retryInitialDelayMs: number;
  private readonly retryMaxDelayMs: number;

  constructor(private readonly baseUrl: string) {
    this.streamTimeoutMs = envInt("ENGINE_AC_STREAM_TIMEOUT_MS", 15 * 60_000);
    this.maxTimeLimitMs = envInt("ENGINE_AC_MAX_TIME_LIMIT_MS", 20_000);
    this.minTimeLimitMs = envInt("ENGINE_AC_MIN_TIME_LIMIT_MS", 100);
    this.maxMemoryLimitKb = envInt("ENGINE_AC_MAX_MEMORY_LIMIT_KB", 2_097_152);
    this.minMemoryLimitKb = envInt("ENGINE_AC_MIN_MEMORY_LIMIT_KB", 16_384);
    this.retryInitialDelayMs = envInt("ENGINE_AC_RETRY_INITIAL_DELAY_MS", 2_000);
    this.retryMaxDelayMs = envInt("ENGINE_AC_RETRY_MAX_DELAY_MS", 60_000);
  }

  executeBatch = async (request: BatchExecRequest): Promise<BatchExecResult> => {
    const verdict = await this.submit(request, request.inputs);
    if (verdict.verdict === "compilation_error") return { compileError: verdict.compile_stderr ?? "compilation failed" };
    const byIndex = new Map((verdict.results ?? []).map((test) => [test.test_index, test]));
    return { results: request.inputs.map((_, index) => (byIndex.has(index) ? toResult(byIndex.get(index)!) : MISSING)) };
  };

  async execute(request: ExecRequest): Promise<ExecResult> {
    const result = await this.executeBatch({ ...request, inputs: [request.stdin] });
    if ("compileError" in result) return { ...MISSING, status: "compile_error", compileOutput: result.compileError };
    return result.results[0];
  }

  private async submit(request: BatchExecRequest, inputs: string[]): Promise<AetherCodeVerdictData> {
    const timeLimitMs = Math.min(
      this.maxTimeLimitMs,
      Math.max(this.minTimeLimitMs, Math.round(request.timeLimitMs * LANGUAGES[request.language].timeMultiplier)),
    );
    const memoryLimitKb = Math.min(this.maxMemoryLimitKb, Math.max(this.minMemoryLimitKb, request.memoryLimitKb));
    const body = JSON.stringify({
      language: request.language,
      source_code: request.source,
      mode: "run",
      // Output is compared here (lib/compare.ts); the engine's own verdict is not used.
      tests: inputs.map((input) => ({ input, expected_output: "" })),
      time_limit_ms: timeLimitMs,
      memory_limit_kb: memoryLimitKb,
    });
    // Retry on 429 with exponential backoff — engine can be temporarily saturated
    // under concurrent exam load.
    let delayMs = this.retryInitialDelayMs;
    for (;;) {
      const created = await fetch(`${this.baseUrl}/api/v1/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      if (created.status === 429) {
        if (delayMs > this.retryMaxDelayMs) throw new Error(`aethercode execute failed: ${created.status} ${await created.text()}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs + Math.random() * 1_000));
        delayMs = Math.min(delayMs * 2, this.retryMaxDelayMs);
        continue;
      }
      if (!created.ok) throw new Error(`aethercode execute failed: ${created.status} ${await created.text()}`);
      const { job_id } = (await created.json()) as { job_id: string };
      return this.awaitVerdict(job_id);
    }
  }

  private async awaitVerdict(jobId: string): Promise<AetherCodeVerdictData> {
    const response = await fetch(`${this.baseUrl}/api/v1/stream?job_id=${encodeURIComponent(jobId)}`, {
      headers: { accept: "text/event-stream" },
      signal: AbortSignal.timeout(this.streamTimeoutMs),
    });
    if (!response.ok || !response.body) throw new Error(`aethercode stream failed: ${response.status}`);
    const verdict = await readVerdictEvent(response.body);
    if (!verdict) throw new Error("aethercode stream ended without a VERDICT event");
    return verdict;
  }
}

/**
 * Reads an SSE stream until its VERDICT event. Parser state lives across
 * network chunks, since one event can arrive split over several reads.
 */
export async function readVerdictEvent(body: ReadableStream<Uint8Array>): Promise<AetherCodeVerdictData | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "";
  let data: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (line === "") {
          if (event === "VERDICT" && data.length > 0) return (JSON.parse(data.join("\n")) as { data: AetherCodeVerdictData }).data;
          event = "";
          data = [];
        } else if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (done) return null;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function acVerdict(verdict: string): ExecStatus {
  switch (verdict) {
    case "accepted":
    case "wrong_answer":
      return "ok";
    case "compilation_error":
      return "compile_error";
    case "time_limit":
      return "time_limit";
    case "memory_limit":
      return "memory_limit";
    case "output_limit":
    case "runtime_error":
      return "runtime_error";
    default:
      return "internal_error";
  }
}

const b64 = (value: string) => Buffer.from(value, "utf8").toString("base64");
const unb64 = (value: string | null | undefined) => (value ? Buffer.from(value, "base64").toString("utf8") : "");
