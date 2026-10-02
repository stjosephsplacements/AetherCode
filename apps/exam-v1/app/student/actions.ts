"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { sql } from "@/lib/db";
import { ipAllowed } from "@/lib/net";

export async function startExam(examId: string): Promise<void> {
  const user = await requireUser("student");
  const [exam] = await sql<{ allowed_networks: string[] }[]>`SELECT allowed_networks FROM exams WHERE id = ${examId}`;
  if (exam && !ipAllowed(await clientIp(), exam.allowed_networks)) redirect("/student?network=1");
  // Visible and inside its window; the deadline never extends past the window close.
  // In the same statement, draw one question per slot from that slot's pool.
  await sql`
    WITH started AS (
      INSERT INTO attempts (exam_id, user_id, deadline_at)
      SELECT e.id, ${user.id}, least(now() + make_interval(mins => e.duration_minutes), e.ends_at)
      FROM exams e
      WHERE e.id = ${examId} AND e.published AND ${user.batch} = ANY(e.batches) AND now() >= e.starts_at AND now() < e.ends_at
      ON CONFLICT (exam_id, user_id) DO NOTHING
      RETURNING id, exam_id
    )
    INSERT INTO attempt_questions (attempt_id, slot, question_id, points)
    SELECT DISTINCT ON (eq.slot) started.id, eq.slot, eq.question_id, eq.points
    FROM started JOIN exam_questions eq ON eq.exam_id = started.exam_id
    ORDER BY eq.slot, random()`;
  redirect(`/exam/${examId}`);
}
