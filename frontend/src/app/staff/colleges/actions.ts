"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import { actionError } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { requireStaff } from "@/lib/server/staff";

export async function createCollege(_previous: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireStaff();
  if (!staff.isPlatformAdmin) return { error: "Only platform administrators add colleges." };
  const text = (name: string) => String(form.get(name) ?? "").trim();
  try {
    await gateway("/tenant/v1/tenants", {
      method: "POST",
      body: { slug: text("slug").toLowerCase(), legal_name: text("legal_name"), display_name: text("display_name") },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/colleges");
  return { error: null, message: "College added. Switch to it above, then create its departments, batches and administrators." };
}

export async function updateCollege(tenantId: string, changes: Record<string, string>): Promise<ActionState> {
  const staff = await requireStaff();
  if (!staff.isPlatformAdmin) return { error: "Only platform administrators change colleges." };
  const body: Record<string, string> = {};
  if ("legal_name" in changes) body.legal_name = changes.legal_name!.trim();
  if ("display_name" in changes) body.display_name = changes.display_name!.trim();
  try {
    await gateway(`/tenant/v1/tenants/${tenantId}`, { method: "PATCH", body });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff", "layout");
  return { error: null, message: "Saved." };
}

/** Root administrators only. A college is soft-deleted with a reason and shows in the audit log (ADR-0053). */
export async function deleteCollege(tenantId: string, reason: string): Promise<ActionState> {
  const staff = await requireStaff();
  if (!staff.isPlatformAdmin) return { error: "Only platform administrators delete colleges." };
  if (!reason.trim()) return { error: "A reason is needed to delete anything." };
  try {
    await gateway(`/tenant/v1/tenants/${tenantId}`, { method: "DELETE", body: { reason: reason.trim() } });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff", "layout");
  return { error: null, message: "Deleted." };
}
