import { sql } from "@/lib/db";

export async function formOptions() {
  const questionBank = await sql<{ id: string; title: string }[]>`SELECT id, title FROM questions ORDER BY title`;
  const knownBatches = (
    await sql<{ batch: string }[]>`SELECT DISTINCT batch FROM users WHERE role = 'student' AND batch IS NOT NULL ORDER BY batch`
  ).map((row) => row.batch);
  return { questionBank, knownBatches };
}
