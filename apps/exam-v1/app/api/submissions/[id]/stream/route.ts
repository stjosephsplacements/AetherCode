import { HttpError, ownsAttempt, requireExamTaker } from "@/lib/attempts";
import { sql } from "@/lib/db";
import { onSubmissionDone } from "@/lib/notify";

export const dynamic = "force-dynamic";

async function verdictPayload(id: string) {
  const rows = await sql<
    Array<{
      s_kind: string;
      s_status: string;
      s_verdict: string | null;
      s_passed: number;
      s_total: number;
      s_compile_output: string | null;
      s_custom_input: string | null;
      r_ord: number | null;
      r_is_sample: boolean | null;
      r_verdict: string | null;
      r_stdout: string | null;
      r_stderr: string | null;
      r_time_ms: number | null;
      t_input: string | null;
      t_expected_output: string | null;
    }>
  >`
    SELECT s.kind AS s_kind, s.status AS s_status, s.verdict AS s_verdict,
           s.passed AS s_passed, s.total AS s_total,
           s.compile_output AS s_compile_output, s.custom_input AS s_custom_input,
           r.ord AS r_ord, r.is_sample AS r_is_sample, r.verdict AS r_verdict,
           r.stdout AS r_stdout, r.stderr AS r_stderr, r.time_ms AS r_time_ms,
           t.input AS t_input, t.expected_output AS t_expected_output
    FROM submissions s
    LEFT JOIN submission_results r ON r.submission_id = s.id
    LEFT JOIN test_cases t ON t.id = r.test_case_id
    WHERE s.id = ${id} AND (s.status = 'done' OR s.status = 'error')
    ORDER BY r.ord`;
  if (rows.length === 0) return null;
  const s = rows[0];
  return {
    id,
    kind: s.s_kind,
    status: s.s_status,
    verdict: s.s_verdict,
    passed: s.s_passed,
    total: s.s_total,
    compileOutput: s.s_compile_output,
    tests: rows
      .filter((r) => r.r_ord !== null)
      .map((r) =>
        r.r_is_sample
          ? { ord: r.r_ord, sample: true, verdict: r.r_verdict, input: r.t_input ?? s.s_custom_input ?? "", expected: r.t_expected_output, stdout: r.r_stdout, stderr: r.r_stderr, timeMs: r.r_time_ms }
          : { ord: r.r_ord, sample: false, verdict: r.r_verdict },
      ),
  };
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  let user: Awaited<ReturnType<typeof requireExamTaker>>;
  try {
    user = await requireExamTaker();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const [row] = await sql<{ id: string }[]>`
    SELECT s.id FROM submissions s JOIN attempts a ON a.id = s.attempt_id
    WHERE s.id = ${id} AND ${ownsAttempt(user)}`;
  if (!row) return new Response("Not found", { status: 404 });

  const existing = await verdictPayload(id);
  if (existing) {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse("verdict", existing)));
        controller.close();
      },
    });
    return new Response(body, { headers: sseHeaders() });
  }

  const abort = AbortSignal.timeout(30_000);
  const body = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        await onSubmissionDone(id, abort);
        const payload = await verdictPayload(id);
        if (payload) controller.enqueue(encoder.encode(sse("verdict", payload)));
      } catch {
        controller.enqueue(encoder.encode(sse("timeout", {})));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { headers: sseHeaders() });
}

function sseHeaders(): HeadersInit {
  return {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  };
}
