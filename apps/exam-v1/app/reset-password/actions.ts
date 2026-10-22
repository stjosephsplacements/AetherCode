"use server";

import { sql } from "@/lib/db";
import { consumeResetToken } from "@/lib/reset-token";
import { hashPassword } from "@/lib/password";

export async function resetPassword(_: string | null, form: FormData): Promise<string | null> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  if (!token) return "Invalid reset link.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password !== confirm) return "Passwords do not match.";

  const result = await consumeResetToken(token);
  if (!result) return "This reset link is invalid or has expired. Please request a new one.";

  const hash = await hashPassword(password);
  await sql`
    UPDATE users SET password_hash = ${hash}, must_change_password = false
    WHERE id = ${result.userId}`;
  await sql`DELETE FROM sessions WHERE user_id = ${result.userId}`;

  return "ok";
}
