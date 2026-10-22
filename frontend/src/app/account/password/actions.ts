"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/staff/form";
import { GatewayError, gateway } from "@/lib/server/gateway";
import { requireViewer } from "@/lib/server/session";
import { PASSWORD_COOKIE } from "@/lib/server/tokens";
import { homeFor, safeNext } from "@/lib/viewer";

/** Replaces the signed-in user's password (ADR-0036). */
export async function changePassword(_previous: ActionState, form: FormData): Promise<ActionState> {
  const viewer = await requireViewer();
  const current = String(form.get("current_password") ?? "");
  const next = String(form.get("new_password") ?? "");
  if (next.length < 12) return { error: "Use at least 12 characters." };
  if (next !== String(form.get("confirm_password") ?? "")) return { error: "The two new passwords do not match." };
  try {
    await gateway("/identity/v1/auth/password", { method: "POST", body: { current_password: current, new_password: next } });
  } catch (error) {
    if (error instanceof GatewayError && error.status === 401) return { error: "Your current password is wrong." };
    return { error: error instanceof GatewayError ? error.message : "The password could not be changed. Try again." };
  }
  (await cookies()).delete(PASSWORD_COOKIE);
  redirect(safeNext(String(form.get("next") ?? "")) ?? homeFor(viewer));
}
