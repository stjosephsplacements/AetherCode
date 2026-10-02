import { handle, HttpError, ownsAttempt, requireExamTaker } from "@/lib/attempts";
import { sql } from "@/lib/db";

// Polled by the exam screen; returns announcements newer than ?after=<id>.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireExamTaker();
    const attemptId = (await params).id;
    if (!/^[0-9a-f-]{36}$/i.test(attemptId)) throw new HttpError(404, "Attempt not found.");
    const after = Number(new URL(request.url).searchParams.get("after") ?? 0) || 0;
    const rows = await sql<{ id: string; message: string; created_at: Date }[]>`
      SELECT n.id, n.message, n.created_at FROM announcements n
      JOIN attempts a ON a.exam_id = n.exam_id
      WHERE a.id = ${attemptId} AND ${ownsAttempt(user)} AND n.id > ${after}
      ORDER BY n.id`;
    return Response.json({ announcements: rows.map((row) => ({ id: Number(row.id), message: row.message, at: row.created_at })) });
  });
}
