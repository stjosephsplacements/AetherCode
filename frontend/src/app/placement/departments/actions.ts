"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import { actionError } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { requirePlacement } from "@/lib/server/placement";

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export async function createPlacementOrganization(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requirePlacement();
  try {
    await gateway("/tenant/v1/placement-organizations", {
      method: "POST",
      body: { code: text(form, "code").toUpperCase(), legal_name: text(form, "legal_name") },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/placement/departments");
  return { error: null, message: "Placement organization created." };
}

export async function createPlacementDepartment(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requirePlacement();
  try {
    await gateway(`/tenant/v1/placement-organizations/${text(form, "organization_id")}/departments`, {
      method: "POST",
      body: { code: text(form, "code").toUpperCase(), name: text(form, "name") },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/placement/departments");
  return { error: null, message: "Placement department created." };
}

export async function updatePlacementOrganization(organizationId: string, changes: Record<string, string>): Promise<ActionState> {
  const placement = await requirePlacement();
  if (!placement.isPlatformAdmin) return { error: "Only platform administrators change placement organizations." };
  try {
    await gateway(`/tenant/v1/placement-organizations/${organizationId}`, { method: "PATCH", body: { legal_name: changes.legal_name?.trim() } });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/placement/departments");
  return { error: null, message: "Saved." };
}

export async function deletePlacementOrganization(organizationId: string, reason: string): Promise<ActionState> {
  const placement = await requirePlacement();
  if (!placement.isPlatformAdmin) return { error: "Only platform administrators delete placement organizations." };
  if (!reason.trim()) return { error: "A reason is needed to delete anything." };
  try {
    await gateway(`/tenant/v1/placement-organizations/${organizationId}`, { method: "DELETE", body: { reason: reason.trim() } });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/placement/departments");
  return { error: null, message: "Deleted." };
}
