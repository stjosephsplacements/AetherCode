// Simulates an exam: N students each load the exam page, autosave, Run, and Submit.
//
//   pnpm loadtest --url http://localhost:3000 --students 1000 --ramp 60
//   pnpm loadtest --cleanup
//
// It creates its own batch (LOADTEST), question, exam, students, sessions and
// attempts directly in the database, so the real app and worker must be running
// against the same DATABASE_URL. --cleanup removes all of it.
import { createHash, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { sql } from "../lib/db.ts";
import { hashPassword } from "../lib/password.ts";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:3000" },
    students: { type: "string", default: "200" },
    ramp: { type: "string", default: "30" },
    runs: { type: "string", default: "3" },
    cleanup: { type: "boolean", default: false },
  },
});

const BATCH = "LOADTEST";
const TITLE = "Load test exam";

async function cleanup() {
  await sql.begin(async (tx) => {
    const questionIds = (
      await tx<{ question_id: string }[]>`
        SELECT eq.question_id FROM exam_questions eq JOIN exams e ON e.id = eq.exam_id WHERE e.title = ${TITLE}`
    ).map((row) => row.question_id);
    const attemptIds = (
      await tx<{ id: string }[]>`SELECT a.id FROM attempts a JOIN users u ON u.id = a.user_id WHERE u.batch = ${BATCH}`
    ).map((row) => row.id);
    // Drafts and events cascade from attempts; test cases and exam questions cascade from their parents.
    await tx`DELETE FROM submissions WHERE attempt_id = ANY(${attemptIds})`;
    await tx`DELETE FROM attempts WHERE id = ANY(${attemptIds})`;
    await tx`DELETE FROM users WHERE batch = ${BATCH}`;
    await tx`DELETE FROM exams WHERE title = ${TITLE}`;
    await tx`DELETE FROM questions WHERE id = ANY(${questionIds})`;
  });
}

const SOLUTIONS: Array<[string, string]> = [
  ["python", "n = int(input())\nprint(n * (n + 1) // 2)\n"],
  ["c", '#include <stdio.h>\nint main(void){long long n;scanf("%lld",&n);printf("%lld\\n",n*(n+1)/2);return 0;}\n'],
  ["cpp", "#include <bits/stdc++.h>\nint main(){long long n;std::cin>>n;std::cout<<n*(n+1)/2<<\"\\n\";}\n"],
  [
    "java",
    "import java.util.*;\npublic class Main{public static void main(String[] a){long n=new Scanner(System.in).nextLong();System.out.println(n*(n+1)/2);}}\n",
  ],
];

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function setup(count: number) {
  await cleanup();
  const [question] = await sql<{ id: string }[]>`
    INSERT INTO questions (title, statement, time_limit_ms, memory_limit_kb)
    VALUES ('Load test: sum to n', 'Print n(n+1)/2.', 2000, 262144) RETURNING id`;
  const tests = Array.from({ length: 10 }, (_, index) => {
    const n = index === 0 ? 5 : 10 ** (index % 7) + index;
    return { question_id: question.id, ord: index, input: `${n}\n`, expected_output: `${(BigInt(n) * BigInt(n + 1)) / 2n}\n`, is_sample: index < 2, weight: 1 };
  });
  await sql`INSERT INTO test_cases ${sql(tests)}`;
  const [exam] = await sql<{ id: string }[]>`
    INSERT INTO exams (title, starts_at, ends_at, duration_minutes, languages, batches, published)
    VALUES (${TITLE}, now() - interval '5 minutes', now() + interval '3 hours', 120, ${["c", "cpp", "java", "python"]}, ${[BATCH]}, true)
    RETURNING id`;
  await sql`INSERT INTO exam_questions (exam_id, question_id, ord, points) VALUES (${exam.id}, ${question.id}, 0, 100)`;

  // One shared hash keeps setup fast; the load test does not exercise sign-in.
  const passwordHash = await hashPassword(randomBytes(12).toString("base64url"));
  const students = Array.from({ length: count }, (_, index) => ({
    username: `loadtest${String(index).padStart(5, "0")}`,
    name: `Load ${index}`,
    role: "student",
    batch: BATCH,
    password_hash: passwordHash,
  }));
  const users: Array<{ id: string }> = [];
  for (let index = 0; index < students.length; index += 1000) {
    users.push(...(await sql<{ id: string }[]>`INSERT INTO users ${sql(students.slice(index, index + 1000))} RETURNING id`));
  }
  const sessions = users.map((user) => ({ token: randomBytes(32).toString("base64url"), userId: user.id }));
  for (let index = 0; index < sessions.length; index += 1000) {
    const chunk = sessions.slice(index, index + 1000);
    await sql`INSERT INTO sessions ${sql(
      chunk.map((session) => ({
        token_hash: createHash("sha256").update(session.token).digest("hex"),
        user_id: session.userId,
        expires_at: new Date(Date.now() + 6 * 3600_000),
      })),
    )}`;
  }
  const attempts: Array<{ id: string; user_id: string }> = [];
  for (let index = 0; index < users.length; index += 1000) {
    attempts.push(
      ...(await sql<{ id: string; user_id: string }[]>`
        INSERT INTO attempts ${sql(users.slice(index, index + 1000).map((user) => ({ exam_id: exam.id, user_id: user.id, deadline_at: new Date(Date.now() + 2 * 3600_000) })))}
        RETURNING id, user_id`),
    );
  }
  const attemptByUser = new Map(attempts.map((attempt) => [attempt.user_id, attempt.id]));
  return {
    examId: exam.id,
    questionId: question.id,
    students: sessions.map((session) => ({ token: session.token, attemptId: attemptByUser.get(session.userId)! })),
  };
}

const metrics = { page: [] as number[], draft: [] as number[], run: [] as number[], submit: [] as number[], errors: new Map<string, number>() };
const fail = (label: string) => metrics.errors.set(label, (metrics.errors.get(label) ?? 0) + 1);

async function student(base: string, examId: string, questionId: string, token: string, attemptId: string, index: number, runs: number) {
  const headers = { cookie: `sid=${token}`, "content-type": "application/json" };
  const [language, source] = SOLUTIONS[index % SOLUTIONS.length];
  const timed = async (bucket: number[], label: string, request: () => Promise<Response>) => {
    const started = performance.now();
    const response = await request().catch(() => null);
    if (!response || !response.ok) {
      fail(`${label} ${response?.status ?? "network"}`);
      return null;
    }
    bucket.push(performance.now() - started);
    return response;
  };

  await timed(metrics.page, "page", () => fetch(`${base}/exam/${examId}`, { headers }));
  for (let draft = 0; draft < 3; draft++) {
    await timed(metrics.draft, "draft", () =>
      fetch(`${base}/api/attempts/${attemptId}/drafts`, { method: "PUT", headers, body: JSON.stringify({ questionId, language, source }) }),
    );
    await sleep(1000 + Math.random() * 2000);
  }

  const judge = async (kind: "run" | "submit") => {
    const started = performance.now();
    const created = await fetch(`${base}/api/attempts/${attemptId}/submissions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ questionId, language, source, kind }),
    }).catch(() => null);
    if (!created || created.status !== 202) return fail(`${kind} create ${created?.status ?? "network"}`);
    const { id } = (await created.json()) as { id: string };
    for (let polls = 0; polls < 600; polls++) {
      await sleep(1000);
      const view = (await fetch(`${base}/api/submissions/${id}`, { headers })
        .then((response) => response.json())
        .catch(() => null)) as { status?: string; verdict?: string } | null;
      if (view?.status === "done" || view?.status === "error") {
        if (view.verdict !== "accepted") fail(`${kind} verdict ${view.verdict}`);
        (kind === "run" ? metrics.run : metrics.submit).push(performance.now() - started);
        return;
      }
    }
    fail(`${kind} timeout`);
  };
  for (let run = 0; run < runs; run++) {
    await judge("run");
    await sleep(2000 + Math.random() * 4000);
  }
  await judge("submit");
}

if (values.cleanup) {
  await cleanup();
  console.log("load test data removed");
} else {
  const count = Number(values.students);
  const rampMs = Number(values.ramp) * 1000;
  const runs = Number(values.runs);
  console.log(`setting up ${count} students…`);
  const fixture = await setup(count);
  console.log(`exam ${fixture.examId}; ramping ${count} students over ${values.ramp}s, ${runs} runs + 1 submit each`);
  const started = performance.now();
  const progress = setInterval(async () => {
    const [row] = await sql<{ queued: number; running: number; done: number }[]>`
      SELECT count(*) FILTER (WHERE s.status = 'queued')::int AS queued, count(*) FILTER (WHERE s.status = 'running')::int AS running,
        count(*) FILTER (WHERE s.status IN ('done', 'error'))::int AS done
      FROM submissions s JOIN attempts a ON a.id = s.attempt_id WHERE a.exam_id = ${fixture.examId}`;
    console.log(`  t=${Math.round((performance.now() - started) / 1000)}s queued=${row.queued} running=${row.running} done=${row.done}`);
  }, 5000);
  await Promise.all(
    fixture.students.map(async (entry, index) => {
      await sleep((rampMs * index) / count);
      await student(values.url!, fixture.examId, fixture.questionId, entry.token, entry.attemptId, index, runs);
    }),
  );
  clearInterval(progress);
  const line = (label: string, values: number[]) =>
    console.log(`${label.padEnd(18)} n=${String(values.length).padStart(5)}  p50=${Math.round(percentile(values, 50))}ms  p95=${Math.round(percentile(values, 95))}ms  max=${Math.round(Math.max(...values))}ms`);
  console.log(`\nfinished in ${Math.round((performance.now() - started) / 1000)}s`);
  line("exam page load", metrics.page);
  line("autosave", metrics.draft);
  line("run → verdict", metrics.run);
  line("submit → verdict", metrics.submit);
  console.log(metrics.errors.size === 0 ? "errors: none" : `errors: ${JSON.stringify(Object.fromEntries(metrics.errors))}`);
  console.log("remove the fixture with: pnpm loadtest --cleanup");
}
await sql.end();
