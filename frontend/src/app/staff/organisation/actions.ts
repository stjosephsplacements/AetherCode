"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import { actionError } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { requireCollege } from "@/lib/server/staff";

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export async function createDepartment(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  try {
    await gateway(`/tenant/v1/tenants/${tenantId}/departments`, {
      method: "POST",
      body: { code: text(form, "code").toUpperCase(), name: text(form, "name") },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/organisation");
  return { error: null, message: "Department created." };
}

export async function createBatch(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  try {
    await gateway(`/tenant/v1/tenants/${tenantId}/batches`, {
      method: "POST",
      body: {
        department_id: text(form, "department_id"),
        code: text(form, "code").toUpperCase(),
        name: text(form, "name"),
        academic_year: text(form, "academic_year"),
      },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/organisation");
  return { error: null, message: "Batch created." };
}

export async function createPlacementOrganization(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireCollege();
  try {
    await gateway("/tenant/v1/placement-organizations", {
      method: "POST",
      body: { code: text(form, "code").toUpperCase(), legal_name: text(form, "legal_name") },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/organisation");
  return { error: null, message: "Placement organization created." };
}

export async function createPlacementDepartment(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireCollege();
  try {
    await gateway(`/tenant/v1/placement-organizations/${text(form, "organization_id")}/departments`, {
      method: "POST",
      body: { code: text(form, "code").toUpperCase(), name: text(form, "name") },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/organisation");
  return { error: null, message: "Placement department created." };
}
