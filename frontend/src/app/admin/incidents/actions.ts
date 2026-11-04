"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import { actionError } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { requireAdmin } from "@/lib/server/staff";

/** The exam version these operations act on; the college must be one the administrator can see. */
async function target(form: FormData) {
  const staff = await requireAdmin();
  const tenantId = String(form.get("tenant_id") ?? "");
  const versionId = String(form.get("exam_version_id") ?? "");
  if (!staff.tenants.some((tenant) => tenant.id === tenantId) || !versionId) return null;
  return `/submission/v1/tenants/${tenantId}/exam-versions/${versionId}`;
}

/** Adds minutes to every attempt in progress in one exam, for example after an outage. */
export async function extendExam(_previous: ActionState, form: FormData): Promise<ActionState> {
  const base = await target(form);
  if (!base) return { error: "That exam is not available." };
  const minutes = Number(form.get("minutes"));
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) return { error: "Enter 1 to 240 minutes." };
  try {
    const { extended_attempts: extended } = await gateway<{ extended_attempts: number }>(`${base}/extensions`, { method: "POST", body: { minutes } });
    revalidatePath("/admin/incidents");
    return { error: null, message: extended ? `Added ${minutes} min for ${extended} student${extended === 1 ? "" : "s"} in progress.` : "Nobody is in progress." };
  } catch (error) {
    return { error: actionError(error) };
  }
}

/** A message on every open exam screen of one exam. */
export async function announceExam(_previous: ActionState, form: FormData): Promise<ActionState> {
  const base = await target(form);
  if (!base) return { error: "That exam is not available." };
  const body = String(form.get("body") ?? "").trim();
  if (!body) return { error: "Write a message first." };
  try {
    await gateway(`${base}/announcements`, { method: "POST", body: { body } });
    revalidatePath("/admin/incidents");
    return { error: null, message: "Sent. Students see it within 15 seconds." };
  } catch (error) {
    return { error: actionError(error) };
  }
}
