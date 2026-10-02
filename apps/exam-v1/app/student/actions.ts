"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function startExam(examId: string): Promise<void> {
  const user = await requireUser("student");
  // Visible and inside its window; the deadline never extends past the window close.
  await sql`
    INSERT INTO attempts (exam_id, user_id, deadline_at)
    SELECT e.id, ${user.id}, least(now() + make_interval(mins => e.duration_minutes), e.ends_at)
    FROM exams e
    WHERE e.id = ${examId} AND e.published AND ${user.batch} = ANY(e.batches) AND now() >= e.starts_at AND now() < e.ends_at
    ON CONFLICT (exam_id, user_id) DO NOTHING`;
  redirect(`/exam/${examId}`);
}
