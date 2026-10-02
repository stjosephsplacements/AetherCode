import { handle, requireOpenAttempt, requireStudent } from "@/lib/attempts";
import { sql } from "@/lib/db";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireStudent();
    const attempt = await requireOpenAttempt((await params).id, user);
    await sql`UPDATE attempts SET finished_at = now() WHERE id = ${attempt.id}`;
    return Response.json({ ok: true });
  });
}
