import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { startSession } from "@/lib/auth";
import { sql } from "@/lib/db";

// SEB's Start URL. SEB has its own cookie jar, so the student's browser session is
// not there; the "Open in SEB" link carries a one-time token that SEB appends here.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  // Accept "?t=" and the "??t=" form in case a SEB build keeps the extra "?".
  const token = params.get("t") ?? params.get("?t");
  if (!token) redirect("/login");
  const [user] = await sql<{ id: string; role: "student" }[]>`
    UPDATE seb_login_tokens t SET used_at = now()
    FROM users u
    WHERE t.token_hash = ${createHash("sha256").update(token).digest("hex")} AND t.used_at IS NULL
      AND t.expires_at > now() AND u.id = t.user_id AND NOT u.disabled
    RETURNING u.id, u.role`;
  if (!user) redirect("/login");
  await startSession(user);
  redirect("/student");
}
