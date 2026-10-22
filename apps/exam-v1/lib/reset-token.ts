import { createHash, randomBytes } from "node:crypto";
import { sql } from "./db.ts";

const TOKEN_HOURS = 1;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createResetToken(userId: string): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  const hash = hashToken(raw);
  // One active token per user — delete unused prior tokens.
  await sql`DELETE FROM password_reset_tokens WHERE user_id = ${userId} AND used_at IS NULL`;
  await sql`
    INSERT INTO password_reset_tokens (token_hash, user_id, expires_at)
    VALUES (${hash}, ${userId}, now() + make_interval(hours => ${TOKEN_HOURS}))`;
  return raw;
}

export async function consumeResetToken(raw: string): Promise<{ userId: string } | null> {
  const hash = hashToken(raw);
  const [row] = await sql<{ user_id: string }[]>`
    UPDATE password_reset_tokens
    SET used_at = now()
    WHERE token_hash = ${hash} AND expires_at > now() AND used_at IS NULL
    RETURNING user_id`;
  return row ? { userId: row.user_id } : null;
}
