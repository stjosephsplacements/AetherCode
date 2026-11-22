"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionState } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { requireCollege } from "@/lib/server/staff";

export async function retryFailedJob(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  const jobId = String(form.get("job_id") ?? "");
  try {
    await gateway(`/submission/v1/tenants/${tenantId}/grading-queue/failed/${jobId}/retry`, { method: "POST" });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/status/failed");
  revalidatePath("/staff/status");
  return { error: null, message: "Requeued." };
}

export async function retryAllFailedJobs(_previous: ActionState, _form: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  try {
    const result = await gateway<{ retried?: number }>(`/submission/v1/tenants/${tenantId}/grading-queue/failed/retry-all`, {
      method: "POST",
    });
    revalidatePath("/staff/status/failed");
    revalidatePath("/staff/status");
    return { error: null, message: `Requeued ${result.retried ?? 0}.` };
  } catch (error) {
    return { error: actionError(error) };
  }
}

export async function dismissFailedJob(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  const jobId = String(form.get("job_id") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (!reason) return { error: "Give a reason to dismiss this failure." };
  try {
    await gateway(`/submission/v1/tenants/${tenantId}/grading-queue/failed/${jobId}`, {
      method: "DELETE",
      body: { reason },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/status/failed");
  revalidatePath("/staff/status");
  return { error: null, message: "Dismissed." };
}
