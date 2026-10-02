import { sql } from "./db.ts";
import { examSlots } from "./results.ts";
import { similarPairs } from "./similarity.ts";

export interface ReportPair {
  score: number;
  a: { attemptId: string; username: string; name: string; language: string };
  b: { attemptId: string; username: string; name: string; language: string };
}

export interface SlotReport {
  slot: number;
  title: string;
  programs: number;
  pairs: ReportPair[];
}

// Each student's final code per slot: their latest submission, else their draft.
export async function finalCode(examId: string) {
  return sql<Array<{ attempt_id: string; slot: number; username: string; name: string; language: string; source: string }>>`
    SELECT a.id AS attempt_id, aq.slot, u.username, u.name,
      coalesce(s.language, d.language) AS language, coalesce(s.source, d.source) AS source
    FROM attempts a
    JOIN users u ON u.id = a.user_id
    JOIN attempt_questions aq ON aq.attempt_id = a.id
    LEFT JOIN LATERAL (
      SELECT language, source FROM submissions
      WHERE attempt_id = a.id AND question_id = aq.question_id AND kind = 'submit'
      ORDER BY created_at DESC LIMIT 1
    ) s ON true
    LEFT JOIN drafts d ON d.attempt_id = a.id AND d.question_id = aq.question_id
    WHERE a.exam_id = ${examId} AND NOT a.is_preview AND coalesce(s.source, d.source) IS NOT NULL`;
}

export async function similarityReport(examId: string): Promise<SlotReport[]> {
  const [slots, code] = await Promise.all([examSlots(examId), finalCode(examId)]);
  return slots.map((slot) => {
    const programs = code.filter((row) => row.slot === slot.slot);
    const byAttempt = new Map(programs.map((row) => [row.attempt_id, row]));
    const pairs = similarPairs(programs.map((row) => ({ id: row.attempt_id, source: row.source }))).slice(0, 100);
    const person = (id: string) => {
      const row = byAttempt.get(id)!;
      return { attemptId: id, username: row.username, name: row.name, language: row.language };
    };
    return {
      slot: slot.slot,
      title: slot.title,
      programs: programs.length,
      pairs: pairs.map((pair) => ({ score: pair.score, a: person(pair.a), b: person(pair.b) })),
    };
  });
}
