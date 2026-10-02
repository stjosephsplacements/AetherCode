import { hostname } from "node:os";
import { sql } from "../lib/db.ts";
import { engineFromEnv } from "../lib/engine.ts";
import { createLimiter, grade, type GradeTest } from "../lib/grade.ts";
import { DRAFT_GRACE_SECONDS } from "../lib/attempt-rules.ts";
import { isLanguageId } from "../lib/languages.ts";

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 8);
// Keep enough submissions in flight to saturate the engine across test fan-out.
const MAX_IN_FLIGHT = CONCURRENCY * 2;
const MAX_TRIES = 3;
const IDLE_POLL_MS = 250;
const OUTPUT_LIMIT = 8192;

const engine = engineFromEnv();
const limit = createLimiter(CONCURRENCY);
let inFlight = 0;
let stopping = false;

interface Claimed {
  id: string;
  question_id: string;
  kind: "run" | "submit";
  language: string;
  source: string;
  custom_input: string | null;
  tries: number;
}

const clip = (value: string) => (value.length > OUTPUT_LIMIT ? value.slice(0, OUTPUT_LIMIT) + "\n…[truncated]" : value);

async function claim(count: number): Promise<Claimed[]> {
  // A crashed worker leaves rows in "running"; reclaim them after 5 minutes.
  // Runs go first: they are small (sample tests only) and a student is waiting on
  // them, while a submit is already saved and only its score is pending.
  return sql<Claimed[]>`
    UPDATE submissions SET status = 'running', claimed_at = now(), tries = tries + 1
    WHERE id IN (
      SELECT id FROM submissions
      WHERE status = 'queued' OR (status = 'running' AND claimed_at < now() - interval '5 minutes')
      ORDER BY kind = 'run' DESC, created_at
      LIMIT ${count}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, question_id, kind, language, source, custom_input, tries`;
}

async function evaluate(submission: Claimed): Promise<void> {
  if (!isLanguageId(submission.language)) throw new Error(`unsupported language ${submission.language}`);
  const [question] = await sql<{ time_limit_ms: number; memory_limit_kb: number }[]>`
    SELECT time_limit_ms, memory_limit_kb FROM questions WHERE id = ${submission.question_id}`;
  let tests: GradeTest[];
  if (submission.kind === "run" && submission.custom_input !== null) {
    tests = [{ id: null, input: submission.custom_input, expectedOutput: null, isSample: true, weight: 1 }];
  } else {
    const rows = await sql<{ id: string; input: string; expected_output: string; is_sample: boolean; weight: number }[]>`
      SELECT id, input, expected_output, is_sample, weight FROM test_cases
      WHERE question_id = ${submission.question_id} AND (${submission.kind === "submit"} OR is_sample)
      ORDER BY is_sample DESC, ord`;
    tests = rows.map((row) => ({
      id: row.id,
      input: row.input,
      expectedOutput: row.expected_output,
      isSample: row.is_sample,
      weight: row.weight,
    }));
  }
  if (tests.length === 0) {
    await sql`
      UPDATE submissions SET status = 'done', verdict = 'internal_error', finished_at = now(),
        compile_output = 'This question has no test cases for this action.'
      WHERE id = ${submission.id}`;
    return;
  }

  const outcome = await grade(engine, limit, {
    language: submission.language,
    source: submission.source,
    timeLimitMs: question.time_limit_ms,
    memoryLimitKb: question.memory_limit_kb,
    tests,
  });

  await sql.begin(async (tx) => {
    await tx`DELETE FROM submission_results WHERE submission_id = ${submission.id}`;
    const rows = outcome.outcomes.map((result) => ({
      submission_id: submission.id,
      ord: result.ord,
      test_case_id: result.test.id,
      is_sample: result.test.isSample,
      verdict: result.verdict,
      stdout: clip(result.stdout),
      stderr: clip(result.stderr),
      time_ms: result.timeMs,
      memory_kb: result.memoryKb,
    }));
    await tx`INSERT INTO submission_results ${tx(rows)}`;
    await tx`
      UPDATE submissions SET
        status = 'done', verdict = ${outcome.verdict}, passed = ${outcome.passed}, total = ${tests.length},
        earned_weight = ${outcome.earnedWeight}, total_weight = ${outcome.totalWeight},
        compile_output = ${clip(outcome.compileOutput)}, finished_at = now()
      WHERE id = ${submission.id}`;
  });
}

async function handle(submission: Claimed): Promise<void> {
  try {
    await evaluate(submission);
  } catch (error) {
    console.error(`submission ${submission.id} try ${submission.tries} failed:`, error);
    if (submission.tries >= MAX_TRIES) {
      await sql`
        UPDATE submissions SET status = 'error', verdict = 'internal_error', finished_at = now(),
          compile_output = 'The judge could not evaluate this submission. Please try again.'
        WHERE id = ${submission.id}`;
    } else {
      await sql`UPDATE submissions SET status = 'queued' WHERE id = ${submission.id}`;
    }
  } finally {
    inFlight--;
  }
}

// After an attempt ends, submit each question's latest draft unless that exact
// code was already submitted. Waits out the drafts endpoint's grace period first.
async function finalizeEndedAttempts(): Promise<number> {
  const rows = await sql`
    WITH due AS (
      SELECT id FROM attempts
      WHERE finalized_at IS NULL
        AND (finished_at IS NOT NULL OR deadline_at <= now() - make_interval(secs => ${DRAFT_GRACE_SECONDS + 5}))
      LIMIT 200
      FOR UPDATE SKIP LOCKED
    ),
    submitted AS (
      INSERT INTO submissions (attempt_id, question_id, kind, language, source)
      SELECT d.attempt_id, d.question_id, 'submit', d.language, d.source
      FROM drafts d JOIN due ON due.id = d.attempt_id
      WHERE length(trim(d.source)) > 0 AND NOT EXISTS (
        SELECT 1 FROM submissions s
        WHERE s.attempt_id = d.attempt_id AND s.question_id = d.question_id AND s.kind = 'submit'
          AND s.language = d.language AND s.source = d.source
      )
      RETURNING 1
    )
    UPDATE attempts SET finalized_at = now() WHERE id IN (SELECT id FROM due)
    RETURNING id`;
  return rows.length;
}

const WORKER_ID = `${hostname()}:${process.pid}`;
const ENGINE_LABEL = `${process.env.ENGINE ?? "judge0"}${engine.executeBatch ? " (batched)" : ""}`;

async function heartbeatLoop(): Promise<void> {
  while (!stopping) {
    await sql`
      INSERT INTO worker_heartbeats (worker_id, seen_at, in_flight, engine)
      VALUES (${WORKER_ID}, now(), ${inFlight}, ${ENGINE_LABEL})
      ON CONFLICT (worker_id) DO UPDATE SET seen_at = now(), in_flight = EXCLUDED.in_flight, engine = EXCLUDED.engine`.catch((error) =>
      console.error("heartbeat failed:", error),
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function finalizeLoop(): Promise<void> {
  while (!stopping) {
    try {
      const count = await finalizeEndedAttempts();
      if (count > 0) console.log(`finalized ${count} attempt(s)`);
    } catch (error) {
      console.error("finalize failed:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function loop(): Promise<void> {
  console.log(`worker started: engine=${process.env.ENGINE ?? "judge0"} concurrency=${CONCURRENCY}`);
  while (!stopping) {
    const free = MAX_IN_FLIGHT - inFlight;
    const claimed = free > 0 ? await claim(free).catch((error) => (console.error("claim failed:", error), [])) : [];
    for (const submission of claimed) {
      inFlight++;
      void handle(submission);
    }
    if (claimed.length === 0) await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS));
  }
  while (inFlight > 0) await new Promise((resolve) => setTimeout(resolve, 100));
  await sql.end();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

void loop();
void finalizeLoop();
void heartbeatLoop();
