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

export interface Engine {
  execute(request: ExecRequest): Promise<ExecResult>;
}

export function engineFromEnv(): Engine {
  const url = process.env.ENGINE_URL;
  if (!url) throw new Error("ENGINE_URL is required");
  const kind = process.env.ENGINE ?? "judge0";
  if (kind === "judge0") return new Judge0Engine(url, process.env.ENGINE_AUTH_TOKEN ?? "");
  if (kind === "piston") return new PistonEngine(url);
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

export class Judge0Engine implements Engine {
  constructor(
    private readonly baseUrl: string,
    private readonly authToken: string,
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.authToken) headers["x-auth-token"] = this.authToken;
    return headers;
  }

  async execute(request: ExecRequest): Promise<ExecResult> {
    const language = LANGUAGES[request.language];
    const cpuSeconds = Math.min(15, (request.timeLimitMs * language.timeMultiplier) / 1000);
    const created = await fetch(`${this.baseUrl}/submissions?base64_encoded=true&wait=false`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        language_id: language.judge0Id,
        source_code: b64(request.source),
        stdin: b64(request.stdin),
        cpu_time_limit: cpuSeconds,
        wall_time_limit: Math.min(30, cpuSeconds * 3 + 2),
        memory_limit: Math.min(512000, request.memoryLimitKb),
      }),
    });
    if (!created.ok) throw new Error(`judge0 create failed: ${created.status} ${await created.text()}`);
    const { token } = (await created.json()) as { token: string };

    const deadline = Date.now() + POLL_DEADLINE_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const response = await fetch(
        `${this.baseUrl}/submissions/${token}?base64_encoded=true&fields=status,stdout,stderr,compile_output,message,time,memory`,
        { headers: this.headers() },
      );
      if (!response.ok) throw new Error(`judge0 poll failed: ${response.status}`);
      const submission = (await response.json()) as Judge0Submission;
      const statusId = submission.status?.id ?? 0;
      if (statusId <= 2) continue;
      return {
        status: judge0Status(statusId),
        stdout: unb64(submission.stdout),
        stderr: unb64(submission.stderr) || unb64(submission.message),
        compileOutput: unb64(submission.compile_output),
        timeMs: submission.time ? Math.round(Number(submission.time) * 1000) : null,
        memoryKb: submission.memory ?? null,
      };
    }
    throw new Error("judge0 result did not arrive in time");
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
