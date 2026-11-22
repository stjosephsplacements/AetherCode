"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import { actionError } from "@/lib/server/actions";
import { listPlacement } from "@/lib/server/directory";
import { gateway } from "@/lib/server/gateway";
import { primaryPlacementOrganization } from "@/lib/server/placement-org";
import { requireAdmin } from "@/lib/server/staff";

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

const refresh = () => {
  revalidatePath("/admin/placement");
  revalidatePath("/admin/placement/departments");
  revalidatePath("/admin/placement/officers");
  revalidatePath("/placement");
};

/** One-time: create the sole placement organisation for this deployment (ADR-0080). */
export async function createPlacementOrganization(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const existing = await listPlacement().catch(() => null);
  if (existing && existing.organizations.length > 0) {
    return { error: "There is already a placement organisation. Add departments under it instead." };
  }
  try {
    await gateway("/tenant/v1/placement-organizations", {
      method: "POST",
      body: { code: text(form, "code").toUpperCase(), legal_name: text(form, "legal_name") },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  refresh();
  return { error: null, message: "Placement organisation created. Add departments next." };
}

/** Create a global placement department under the sole organisation. */
export async function createPlacementDepartment(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const directory = await listPlacement().catch(() => null);
  const organization = directory ? primaryPlacementOrganization(directory) : null;
  if (!organization) return { error: "Create the placement organisation first." };
  try {
    await gateway(`/tenant/v1/placement-organizations/${organization.id}/departments`, {
      method: "POST",
      body: { code: text(form, "code").toUpperCase(), name: text(form, "name") },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  refresh();
  return { error: null, message: "Placement department created." };
}

export async function updatePlacementOrganization(organizationId: string, changes: Record<string, string>): Promise<ActionState> {
  await requireAdmin();
  try {
    await gateway(`/tenant/v1/placement-organizations/${organizationId}`, { method: "PATCH", body: { legal_name: changes.legal_name?.trim() } });
  } catch (error) {
    return { error: actionError(error) };
  }
  refresh();
  return { error: null, message: "Saved." };
}

export async function deletePlacementOrganization(organizationId: string, reason: string): Promise<ActionState> {
  await requireAdmin();
  if (!reason.trim()) return { error: "A reason is needed to delete anything." };
  try {
    await gateway(`/tenant/v1/placement-organizations/${organizationId}`, { method: "DELETE", body: { reason: reason.trim() } });
  } catch (error) {
    return { error: actionError(error) };
  }
  refresh();
  return { error: null, message: "Deleted." };
}

export async function assignPlacementOfficer(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const principalId = text(form, "principal_id");
  const placementDepartmentId = text(form, "placement_department_id");
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
  refresh();
  return { error: null, message: "Placement officer assigned." };
}

export async function removePlacementOfficer(assignmentId: string): Promise<ActionState> {
  await requireAdmin();
  if (!assignmentId) return { error: "Assignment not found." };
  try {
    await gateway(`/user/v1/role-assignments/${assignmentId}/revoke`, { method: "POST", body: {} });
  } catch (error) {
    return { error: actionError(error) };
  }
  refresh();
  return { error: null, message: "Placement officer removed." };
}
