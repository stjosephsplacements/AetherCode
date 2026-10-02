import { currentUser } from "@/lib/auth";
import { sql } from "@/lib/db";

// Downloads questions as an `aethercode-questions` v1 file (all, or ?id=…).
// The file includes model solutions, so share it only with staff.
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || user.role === "student") return new Response("Forbidden", { status: 403 });
  const ids = new URL(request.url).searchParams.getAll("id").filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const questions = await sql<
    Array<{ id: string; title: string; statement: string; time_limit_ms: number; memory_limit_kb: number; reference_language: string | null; reference_source: string | null }>
  >`
    SELECT id, title, statement, time_limit_ms, memory_limit_kb, reference_language, reference_source FROM questions
    WHERE ${ids.length === 0} OR id = ANY(${ids}) ORDER BY title`;
  const tests = await sql<Array<{ question_id: string; input: string; expected_output: string; is_sample: boolean; weight: number }>>`
    SELECT question_id, input, expected_output, is_sample, weight FROM test_cases
    WHERE question_id = ANY(${questions.map((question) => question.id)}) ORDER BY question_id, ord`;
  const body = {
    format: "aethercode-questions",
    version: 1,
    exportedAt: new Date().toISOString(),
    questions: questions.map((question) => ({
      title: question.title,
      statement: question.statement,
      timeLimitMs: question.time_limit_ms,
      memoryLimitMb: Math.round(question.memory_limit_kb / 1024),
      referenceLanguage: question.reference_language,
      referenceSource: question.reference_source,
      tests: tests
        .filter((test) => test.question_id === question.id)
        .map((test) => ({ input: test.input, expectedOutput: test.expected_output, isSample: test.is_sample, weight: test.weight })),
    })),
  };
  const name = questions.length === 1 ? questions[0].title.replace(/[^A-Za-z0-9]+/g, "-") : "questions";
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${name}.aethercode.json"` },
  });
}
