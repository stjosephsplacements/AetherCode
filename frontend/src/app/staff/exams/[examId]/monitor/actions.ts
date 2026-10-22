"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import { actionError } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { requireCollege } from "@/lib/server/staff";

/** The exam version these operations act on, and where to refresh afterwards. */
async function target(form: FormData) {
  const { tenantId } = await requireCollege();
  const examId = String(form.get("exam_id") ?? "");
  const versionId = String(form.get("exam_version_id") ?? "");
  return { base: `/submission/v1/tenants/${tenantId}/exam-versions/${versionId}`, path: `/staff/exams/${examId}/monitor` };
}

export async function extendTime(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { base, path } = await target(form);
  const attemptId = String(form.get("attempt_id") ?? "");
  const minutes = Number(form.get("minutes"));
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) return { error: "Enter 1 to 240 minutes." };
  try {
    const { extended_attempts: extended } = await gateway<{ extended_attempts: number }>(`${base}/extensions`, {
      method: "POST",
      body: attemptId ? { minutes, attempt_id: attemptId } : { minutes },
    });
    revalidatePath(path);
    if (attemptId) return { error: null, message: `Added ${minutes} min.` };
    return { error: null, message: extended ? `Added ${minutes} min for ${extended} student${extended === 1 ? "" : "s"} in progress.` : "Nobody is in progress." };
  } catch (error) {
    return { error: actionError(error) };
  }
}

export async function postAnnouncement(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { base, path } = await target(form);
  const body = String(form.get("body") ?? "").trim();
  if (!body) return { error: "Write a message first." };
  try {
    await gateway(`${base}/announcements`, { method: "POST", body: { body } });
    revalidatePath(path);
    return { error: null, message: "Sent. Students see it within 15 seconds." };
  } catch (error) {
    return { error: actionError(error) };
  }
}

export async function setResultsRelease(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { base, path } = await target(form);
  const released = form.get("released") === "true";
  try {
    await gateway(`${base}/results-release`, { method: "PUT", body: { released } });
    revalidatePath(path);
    return { error: null, message: released ? "Results released. Students now see their scores." : "Results hidden again." };
  } catch (error) {
    return { error: actionError(error) };
  }
}

/** Fullscreen requirement and paste guard for the exam (ADR-0037). */
export async function setIntegrity(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { base, path } = await target(form);
  try {
    await gateway(`${base}/integrity`, {
      method: "PUT",
      body: { require_fullscreen: form.get("require_fullscreen") === "on", block_external_paste: form.get("block_external_paste") === "on" },
    });
    revalidatePath(path);
    return { error: null, message: "Saved. Open exam screens apply it within 15 seconds." };
  } catch (error) {
    return { error: actionError(error) };
  }
}
