import { z } from "zod";
import { handle, HttpError, requireOpenAttempt, requireExamTaker } from "@/lib/attempts";
import { sql } from "@/lib/db";

const body = z.object({ kind: z.enum(["blur", "paste", "fullscreen_exit"]) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireExamTaker();
    const attempt = await requireOpenAttempt((await params).id, user);
    const parsed = body.safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400, "Invalid event.");
    await sql`INSERT INTO attempt_events (attempt_id, kind) VALUES (${attempt.id}, ${parsed.data.kind})`;
    return Response.json({ ok: true });
  });
}
