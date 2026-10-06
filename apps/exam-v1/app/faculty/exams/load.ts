import { sql } from "@/lib/db";

export async function formOptions() {
  const [questionBank, knownBatchRows] = await Promise.all([
    sql<{ id: string; title: string }[]>`SELECT id, title FROM questions ORDER BY title`,
    sql<{ batch: string }[]>`SELECT DISTINCT batch FROM users WHERE role = 'student' AND batch IS NOT NULL ORDER BY batch`,
  ]);
  return {
    questionBank,
    knownBatches: knownBatchRows.map((row) => row.batch),
  };
}
