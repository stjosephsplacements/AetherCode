import { handle, HttpError, ownsAttempt, requireExamTaker } from "@/lib/attempts";
import { sql } from "@/lib/db";

// Sample tests are shown in full; hidden tests only reveal pass/fail.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireExamTaker();
    const id = (await params).id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Not found.");
    const [submission] = await sql<
      Array<{ id: string; kind: string; status: string; verdict: string | null; passed: number; total: number; compile_output: string | null; custom_input: string | null }>
    >`
      SELECT s.id, s.kind, s.status, s.verdict, s.passed, s.total, s.compile_output, s.custom_input
      FROM submissions s JOIN attempts a ON a.id = s.attempt_id
      WHERE s.id = ${id} AND ${ownsAttempt(user)}`;
    if (!submission) throw new HttpError(404, "Not found.");
    if (submission.status === "queued" || submission.status === "running") return Response.json({ id, status: submission.status });
    const results = await sql<
      Array<{ ord: number; is_sample: boolean; verdict: string; stdout: string | null; stderr: string | null; time_ms: number | null; input: string | null; expected_output: string | null }>
    >`
      SELECT r.ord, r.is_sample, r.verdict, r.stdout, r.stderr, r.time_ms, t.input, t.expected_output
      FROM submission_results r LEFT JOIN test_cases t ON t.id = r.test_case_id
      WHERE r.submission_id = ${id} ORDER BY r.ord`;
    return Response.json({
      id,
      kind: submission.kind,
      status: submission.status,
      verdict: submission.verdict,
      passed: submission.passed,
      total: submission.total,
      compileOutput: submission.compile_output,
      tests: results.map((result) =>
        result.is_sample
          ? {
              ord: result.ord,
              sample: true,
              verdict: result.verdict,
              input: result.input ?? submission.custom_input ?? "",
              expected: result.expected_output,
              stdout: result.stdout,
              stderr: result.stderr,
              timeMs: result.time_ms,
            }
          : { ord: result.ord, sample: false, verdict: result.verdict },
      ),
    });
  });
}
