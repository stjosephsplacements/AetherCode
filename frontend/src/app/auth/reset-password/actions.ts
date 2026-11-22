"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GatewayError, gateway } from "@/lib/server/gateway";
import { PASSWORD_COOKIE } from "@/lib/server/tokens";

export type ResetState = { error: string | null };

export async function completeReset(_previous: ResetState, form: FormData): Promise<ResetState> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  if (!token) return { error: "This link is incomplete. Open the link from your email again." };
  if (password.length < 12) return { error: "Use at least 12 characters." };
  if (password !== String(form.get("confirm") ?? "")) return { error: "The two passwords are not the same." };
  try {
    await gateway("/identity/v1/auth/password-reset/complete", { method: "POST", body: { token, password }, anonymous: true });
  } catch (error) {
    if (error instanceof GatewayError && (error.status === 400 || error.status === 401)) {
      return { error: error.status === 400 && /password/i.test(error.message) ? error.message : "This link has expired or was already used. Ask for a new one." };
    }
    if (error instanceof GatewayError && error.status === 429) return { error: "Too many attempts. Wait a few minutes and try again." };
    return { error: "The exam server could not change your password. Try again in a moment." };
  }
  // A staff-issued password the user just replaced no longer needs replacing again (ADR-0036).
  (await cookies()).delete(PASSWORD_COOKIE);
  redirect("/login?reset=done");
}
