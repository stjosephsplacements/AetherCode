import { sql } from "./db.ts";

export interface ExamQuestion {
  id: string;
  title: string;
  points: number;
}

export interface ResultRow {
  userId: string;
  username: string;
  name: string;
  batch: string | null;
  attemptId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  deadlineAt: Date | null;
  scores: Record<string, number | null>;
  total: number;
  pending: number;
  focusLosses: number;
}

export async function examQuestions(examId: string): Promise<ExamQuestion[]> {
  return sql<ExamQuestion[]>`
    SELECT q.id, q.title, eq.points FROM exam_questions eq JOIN questions q ON q.id = eq.question_id
    WHERE eq.exam_id = ${examId} ORDER BY eq.ord`;
}

// A question's score is its best graded submission: points × passed weight / total weight.
// Every student in an assigned batch appears, including those who never started.
export async function examResults(examId: string): Promise<{ questions: ExamQuestion[]; rows: ResultRow[] }> {
  const questions = await examQuestions(examId);
  const rows = await sql<
    Array<{
      user_id: string;
      username: string;
      name: string;
      batch: string | null;
      attempt_id: string | null;
      started_at: Date | null;
      finished_at: Date | null;
      deadline_at: Date | null;
      scores: Record<string, number> | null;
      pending: number;
      focus_losses: number;
    }>
  >`
    WITH roster AS (
      SELECT u.id, u.username, u.name, u.batch FROM users u, exams e
      WHERE e.id = ${examId} AND u.role = 'student' AND u.batch = ANY(e.batches)
      UNION
      SELECT u.id, u.username, u.name, u.batch FROM attempts a JOIN users u ON u.id = a.user_id WHERE a.exam_id = ${examId}
    ),
    best AS (
      SELECT s.attempt_id, s.question_id,
        max(round(eq.points * s.earned_weight::numeric / nullif(s.total_weight, 0), 2)) AS score
      FROM submissions s
      JOIN attempts a ON a.id = s.attempt_id AND a.exam_id = ${examId}
      JOIN exam_questions eq ON eq.exam_id = a.exam_id AND eq.question_id = s.question_id
      WHERE s.kind = 'submit' AND s.status = 'done'
      GROUP BY s.attempt_id, s.question_id
    )
    SELECT r.id AS user_id, r.username, r.name, r.batch,
      a.id AS attempt_id, a.started_at, a.finished_at, a.deadline_at,
      (SELECT jsonb_object_agg(b.question_id, b.score) FROM best b WHERE b.attempt_id = a.id) AS scores,
      (SELECT count(*)::int FROM submissions s WHERE s.attempt_id = a.id AND s.kind = 'submit' AND s.status IN ('queued', 'running')) AS pending,
      (SELECT count(*)::int FROM attempt_events ev WHERE ev.attempt_id = a.id) AS focus_losses
    FROM roster r
    LEFT JOIN attempts a ON a.user_id = r.id AND a.exam_id = ${examId}
    ORDER BY r.batch NULLS LAST, r.username`;
  return {
    questions,
    rows: rows.map((row) => {
      const scores: Record<string, number | null> = {};
      let total = 0;
      for (const question of questions) {
        const score = row.scores?.[question.id];
        scores[question.id] = score === undefined ? null : Number(score);
        total += score === undefined ? 0 : Number(score);
      }
      return {
        userId: row.user_id,
        username: row.username,
        name: row.name,
        batch: row.batch,
        attemptId: row.attempt_id,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        deadlineAt: row.deadline_at,
        scores,
        total: Math.round(total * 100) / 100,
        pending: row.pending,
        focusLosses: row.focus_losses,
      };
    }),
  };
}

export function attemptStatus(row: Pick<ResultRow, "attemptId" | "finishedAt" | "deadlineAt">, now = new Date()): "absent" | "in_progress" | "finished" {
  if (!row.attemptId) return "absent";
  if (row.finishedAt || (row.deadlineAt && row.deadlineAt <= now)) return "finished";
  return "in_progress";
}
