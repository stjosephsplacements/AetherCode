"use server";

import { GatewayError, gateway } from "@/lib/server/gateway";

export type ForgotState = { error: string | null; sent: boolean; email: string };

/** Asks for a reset link. The answer is the same for a known and an unknown address, so it reveals nothing. */
export async function requestReset(_previous: ForgotState, form: FormData): Promise<ForgotState> {
  const email = String(form.get("email") ?? "").trim();
  if (!email.includes("@")) return { error: "Enter the email address on your account.", sent: false, email };
  try {
    await gateway("/identity/v1/auth/password-reset", { method: "POST", body: { email }, anonymous: true });
  } catch (error) {
    if (error instanceof GatewayError && error.status === 400) return { error: "That does not look like an email address.", sent: false, email };
    if (error instanceof GatewayError && error.status === 429) return { error: "Too many requests. Wait an hour and try again.", sent: false, email };
    return { error: "The exam server could not take your request. Try again in a moment.", sent: false, email };
  }
  return { error: null, sent: true, email };
}
