import { z } from "zod";
import { handle, HttpError, requireOpenAttempt, requireStudent } from "@/lib/attempts";
import { sql } from "@/lib/db";

const body = z.object({ kind: z.enum(["blur", "paste", "fullscreen_exit"]) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireStudent();
    const attempt = await requireOpenAttempt((await params).id, user);
    const parsed = body.safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400, "Invalid event.");
    await sql`INSERT INTO attempt_events (attempt_id, kind) VALUES (${attempt.id}, ${parsed.data.kind})`;
    return Response.json({ ok: true });
  });
}
