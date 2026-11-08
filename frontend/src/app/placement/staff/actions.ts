"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import { actionError } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { requirePlacement } from "@/lib/server/placement";

export async function assignPlacementOfficer(_previous: ActionState, form: FormData): Promise<ActionState> {
  const placement = await requirePlacement();
  if (!placement.isPlatformAdmin) return { error: "Only platform administrators assign placement officers." };
  const principalId = String(form.get("principal_id") ?? "").trim();
  const placementDepartmentId = String(form.get("placement_department_id") ?? "").trim();
  if (!principalId || !placementDepartmentId) return { error: "Choose a person and a placement department." };
  try {
    await gateway(`/user/v1/placement-departments/${placementDepartmentId}/staff/${principalId}`, {
      method: "PUT",
      body: {},
    });
    await gateway("/user/v1/role-assignments", {
      method: "POST",
      body: { principal_id: principalId, role_name: "placement_user", scope_kind: "placement_department", scope_id: placementDepartmentId },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/placement/staff");
  return { error: null, message: "Placement officer assigned." };
}

export async function removePlacementOfficer(_previous: ActionState, form: FormData): Promise<ActionState> {
  const placement = await requirePlacement();
  if (!placement.isPlatformAdmin) return { error: "Only platform administrators remove placement officers." };
  const assignmentId = String(form.get("role_assignment_id") ?? "").trim();
  if (!assignmentId) return { error: "Assignment not found." };
  try {
    await gateway(`/user/v1/role-assignments/${assignmentId}/revoke`, { method: "POST", body: {} });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/placement/staff");
  return { error: null, message: "Placement officer removed." };
}

export async function removeOfficerById(assignmentId: string): Promise<ActionState> {
  const placement = await requirePlacement();
  if (!placement.isPlatformAdmin) return { error: "Only platform administrators remove placement officers." };
  if (!assignmentId) return { error: "Assignment not found." };
  try {
    await gateway(`/user/v1/role-assignments/${assignmentId}/revoke`, { method: "POST", body: {} });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/placement/staff");
  return { error: null, message: "Placement officer removed." };
}
