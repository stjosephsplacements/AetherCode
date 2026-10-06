"use server";

import { createHash, randomBytes } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";

/** A one-time token that signs this student in inside SEB (see app/seb/start). */
export async function createSebLoginToken(examId: string): Promise<string> {
  const user = await requireUser("student");
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  await sql`
    INSERT INTO seb_login_tokens (token_hash, user_id, exam_id)
    VALUES (${hash}, ${user.id}, ${examId})`;
  return token;
}
