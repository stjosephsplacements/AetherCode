import { batchFiles, batchStatus, JUDGE0_TOOLCHAIN, parseBatchOutput, zip } from "./batch.ts";
import { LANGUAGES, type LanguageId } from "./languages.ts";

export type ExecStatus = "ok" | "compile_error" | "runtime_error" | "time_limit" | "internal_error";

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

export function engineFromEnv(): Engine {
  const url = process.env.ENGINE_URL;
  if (!url) throw new Error("ENGINE_URL is required");
  const kind = process.env.ENGINE ?? "judge0";
  if (kind === "judge0") return new Judge0Engine(url, process.env.ENGINE_AUTH_TOKEN ?? "", process.env.ENGINE_BATCH !== "false");
  if (kind === "piston") return new PistonEngine(url);
  if (kind === "aethercode") return new AetherCodeEngine(url);
  throw new Error(`unknown ENGINE ${kind}`);
}

const POLL_INTERVAL_MS = 400;
// Piston runs Java as `java Main.java`, which compiles inside the timed run.
const PISTON_JAVA_COMPILE_ALLOWANCE_MS = 3000;
const POLL_DEADLINE_MS = 120_000;

const b64 = (value: string) => Buffer.from(value, "utf8").toString("base64");
const unb64 = (value: string | null | undefined) => (value ? Buffer.from(value, "base64").toString("utf8") : "");

interface Judge0Submission {
  status?: { id: number; description: string };
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  message?: string | null;
  time?: string | null;
  memory?: number | null;
}

// Must stay within MAX_CPU_TIME_LIMIT / MAX_WALL_TIME_LIMIT in deploy/judge0.conf.
const JUDGE0_BATCH_CPU_BUDGET_SECONDS = 100;
const JUDGE0_BATCH_WALL_BUDGET_SECONDS = 200;
const JUDGE0_MULTI_FILE_LANGUAGE_ID = 89;

export class Judge0Engine implements Engine {
  readonly executeBatch?: (request: BatchExecRequest) => Promise<BatchExecResult>;

  constructor(
    private readonly baseUrl: string,
    private readonly authToken: string,
    batching: boolean,
  ) {
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

    const deadline = Date.now() + POLL_DEADLINE_MS + JUDGE0_BATCH_WALL_BUDGET_SECONDS * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
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
    const cpuSeconds = Math.min(15, (request.timeLimitMs * language.timeMultiplier) / 1000);
    const submission = await this.run({
      language_id: language.judge0Id,
      source_code: b64(request.source),
      stdin: b64(request.stdin),
      cpu_time_limit: cpuSeconds,
      wall_time_limit: Math.min(30, cpuSeconds * 3 + 2),
      memory_limit: Math.min(512000, request.memoryLimitKb),
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
    const chunkSize = Math.max(1, Math.floor(JUDGE0_BATCH_CPU_BUDGET_SECONDS / perTestSeconds));
    const chunks: string[][] = [];
    for (let index = 0; index < request.inputs.length; index += chunkSize) chunks.push(request.inputs.slice(index, index + chunkSize));

    const outcomes = await Promise.all(
      chunks.map(async (inputs) => {
        const archive = zip(batchFiles({ language: request.language, source: request.source, inputs, timeLimitMs: request.timeLimitMs }, JUDGE0_TOOLCHAIN));
        const cpuBudget = Math.min(JUDGE0_BATCH_CPU_BUDGET_SECONDS + 10, inputs.length * perTestSeconds + 5);
        const submission = await this.run({
          language_id: JUDGE0_MULTI_FILE_LANGUAGE_ID,
          additional_files: archive.toString("base64"),
          cpu_time_limit: cpuBudget,
          wall_time_limit: Math.min(JUDGE0_BATCH_WALL_BUDGET_SECONDS, cpuBudget * 2 + 10),
          memory_limit: Math.min(512000, request.memoryLimitKb),
          max_file_size: 8192,
        });
        return { inputs, submission };
      }),
    );

    const results: ExecResult[] = [];
    for (const { inputs, submission } of outcomes) {
      if (submission.statusId === 6) return { compileError: unb64(submission.compile_output) };
      const parsed = parseBatchOutput(unb64(submission.stdout), inputs.length);
      for (const entry of parsed) {
        if (!entry) {
          // The whole job hit its budget before reaching this test.
          const status: ExecStatus = submission.statusId === 5 ? "time_limit" : "internal_error";
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
  if (id === 3) return "ok";
  if (id === 5) return "time_limit";
  if (id === 6) return "compile_error";
  if (id >= 7 && id <= 12) return "runtime_error";
  return "internal_error";
}

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
// AetherCode Execution Engine (go-judge backed, SSE results)
// ---------------------------------------------------------------------------

const AC_SSE_TIMEOUT_MS = 300_000;

interface AetherCodeTestResult {
  test_index: number;
  verdict: string;
  cpu_time_ns: number;
  memory_bytes: number;
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

export class AetherCodeEngine implements Engine {
  constructor(private readonly baseUrl: string) {}

  executeBatch = async (request: BatchExecRequest): Promise<BatchExecResult> => {
    const tests = request.inputs.map((input) => ({ input, expected_output: "" }));
    const verdict = await this.submit(request.language, request.source, tests);

    if (verdict.verdict === "compilation_error") {
      return { compileError: verdict.compile_stderr ?? "compilation failed" };
    }

    const perTest = verdict.results ?? [];
    const results: ExecResult[] = request.inputs.map((_, index) => {
      const test = perTest.find((t) => t.test_index === index);
      if (!test) return { status: "internal_error" as ExecStatus, stdout: "", stderr: "", compileOutput: "", timeMs: null, memoryKb: null };
      return {
        status: acVerdict(test.verdict),
        stdout: test.stdout_preview ?? "",
        stderr: test.stderr_preview ?? "",
        compileOutput: "",
        timeMs: Math.round(test.cpu_time_ns / 1_000_000),
        memoryKb: Math.round(test.memory_bytes / 1024),
      };
    });
    return { results };
  };

  async execute(request: ExecRequest): Promise<ExecResult> {
    const tests = [{ input: request.stdin, expected_output: "" }];
    const verdict = await this.submit(request.language, request.source, tests);

    if (verdict.verdict === "compilation_error") {
      return { status: "compile_error", stdout: "", stderr: "", compileOutput: verdict.compile_stderr ?? "compilation failed", timeMs: null, memoryKb: null };
    }

    const test = verdict.results?.[0];
    if (!test) {
      return {
        status: acVerdict(verdict.verdict),
        stdout: "",
        stderr: "",
        compileOutput: "",
        timeMs: verdict.cpu_time_ns ? Math.round(verdict.cpu_time_ns / 1_000_000) : null,
        memoryKb: verdict.memory_bytes ? Math.round(verdict.memory_bytes / 1024) : null,
      };
    }
    return {
      status: acVerdict(test.verdict),
      stdout: test.stdout_preview ?? "",
      stderr: test.stderr_preview ?? "",
      compileOutput: "",
      timeMs: Math.round(test.cpu_time_ns / 1_000_000),
      memoryKb: Math.round(test.memory_bytes / 1024),
    };
  }

  private async submit(
    language: LanguageId,
    sourceCode: string,
    tests: { input: string; expected_output: string }[],
  ): Promise<AetherCodeVerdictData> {
    const created = await fetch(`${this.baseUrl}/api/v1/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language, source_code: sourceCode, mode: "run", tests }),
    });
    if (!created.ok) throw new Error(`aethercode execute failed: ${created.status} ${await created.text()}`);
    const { job_id } = (await created.json()) as { job_id: string };
    return this.awaitVerdict(job_id);
  }

  private async awaitVerdict(jobId: string): Promise<AetherCodeVerdictData> {
    const response = await fetch(`${this.baseUrl}/api/v1/stream?job_id=${jobId}`, {
      headers: { accept: "text/event-stream" },
      signal: AbortSignal.timeout(AC_SSE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`aethercode stream failed: ${response.status}`);
    if (!response.body) throw new Error("aethercode stream has no body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        let dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
            dataLines = [];
          } else if (line.startsWith("data: ")) {
            dataLines.push(line.slice(6));
          } else if (line === "" && currentEvent === "VERDICT" && dataLines.length > 0) {
            const payload = JSON.parse(dataLines.join("\n")) as { data: AetherCodeVerdictData };
            return payload.data;
          } else if (line === "") {
            currentEvent = "";
            dataLines = [];
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    throw new Error("aethercode stream ended without a VERDICT event");
  }
}

function acVerdict(verdict: string): ExecStatus {
  switch (verdict) {
    case "accepted": return "ok";
    case "wrong_answer": return "ok";
    case "compilation_error": return "compile_error";
    case "time_limit": return "time_limit";
    case "memory_limit": return "time_limit";
    case "output_limit": return "runtime_error";
    case "runtime_error": return "runtime_error";
    default: return "internal_error";
  }
}
