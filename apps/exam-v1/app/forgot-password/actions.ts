"use server";

import { sql } from "@/lib/db";
import { createResetToken } from "@/lib/reset-token";
import { sendMail } from "@/lib/mail";
import { publicOrigin } from "@/lib/public-url";

const SUCCESS = "We've sent a password reset link to your email. Check your inbox.";

const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 3;
const WINDOW_MS = 5 * 60_000;

export async function forgotPassword(_: string | null, form: FormData): Promise<string | null> {
  const username = String(form.get("username") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!username) return "Enter your username or roll number.";
  if (!email || !email.includes("@")) return "Enter a valid email address.";

  const key = username.toLowerCase();
  const lock = attempts.get(key);
  if (lock && lock.count >= MAX_ATTEMPTS && lock.until > Date.now())
    return "Too many requests. Please try again in a few minutes.";

  const count = (lock && lock.until > Date.now() ? lock.count : 0) + 1;
  attempts.set(key, { count, until: Date.now() + WINDOW_MS });

  const [user] = await sql<{ id: string; name: string; disabled: boolean }[]>`
    SELECT id, name, disabled FROM users WHERE lower(username) = ${key}`;

  if (!user) return "No account found with that username.";
  if (user.disabled) return "This account is disabled. Contact your administrator.";

  const token = await createResetToken(user.id);
  const origin = await publicOrigin();
  const link = `${origin}/reset-password?token=${token}`;
  try {
    await sendMail({
      to: email,
      subject: "Reset your password — AetherCode",
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="margin-bottom: 4px;">Reset your password</h2>
          <p>Hi ${user.name},</p>
          <p>A password reset was requested for your account <strong>${username}</strong>.</p>
          <p>Click the link below to set a new password. This link expires in 1 hour.</p>
          <p style="margin: 24px 0;">
            <a href="${link}" style="background: #2563eb; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">
              Reset password
            </a>
          </p>
          <p style="font-size: 13px; color: #6b7280;">If you didn't request this, ignore this email. Your password won't change.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 32px;" />
          <p style="font-size: 12px; color: #9ca3af;">AetherCode Assessment Platform</p>
        </div>
      `,
    });
  } catch (error) {
    console.error("Failed to send reset email:", error);
    return "Could not send the email right now. Please try again later or contact your administrator.";
  }

  return SUCCESS;
}
