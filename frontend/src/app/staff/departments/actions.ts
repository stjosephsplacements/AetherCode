"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import type { Page, Student } from "@/lib/api-types";
import { actionError } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { collegeFor, requireCollege, requireStaff } from "@/lib/server/staff";

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export async function createDepartment(_previous: ActionState, form: FormData): Promise<ActionState> {
  const tenantId = collegeFor(await requireStaff());
  try {
    await gateway(`/tenant/v1/tenants/${tenantId}/departments`, {
      method: "POST",
      body: { code: text(form, "code").toUpperCase(), name: text(form, "name") },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/departments");
  return { error: null, message: "Department created." };
}

export async function createBatch(_previous: ActionState, form: FormData): Promise<ActionState> {
  // The department picker lists every college's departments as "<college>:<department>", so the batch lands in the department's own college.
  const [, department = ""] = text(form, "department_id").includes(":") ? text(form, "department_id").split(":") : ["", text(form, "department_id")];
  const tenantId = collegeFor(await requireStaff());
  try {
    await gateway(`/tenant/v1/tenants/${tenantId}/batches`, {
      method: "POST",
      body: {
        department_id: department,
        code: text(form, "code").toUpperCase(),
        name: text(form, "name"),
        academic_year: text(form, "academic_year"),
      },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/departments");
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
  revalidatePath("/staff/departments");
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
  revalidatePath("/staff/departments");
  return { error: null, message: "Placement department created." };
}

/** Deletes a department with no live batch; the database refuses one that still has some (ADR-0053). */
export async function deleteDepartment(collegeId: string, id: string, reason: string): Promise<ActionState> {
  const tenantId = collegeFor(await requireStaff());
  if (!reason.trim()) return { error: "A reason is needed to delete anything." };
  try {
    await gateway(`/tenant/v1/tenants/${tenantId}/departments/${id}`, { method: "DELETE", body: { reason: reason.trim() } });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/departments");
  return { error: null, message: "Deleted." };
}

export async function deleteBatch(collegeId: string, id: string, reason: string): Promise<ActionState> {
  const tenantId = collegeFor(await requireStaff());
  if (!reason.trim()) return { error: "A reason is needed to delete anything." };
  try {
    // Students live in another service's database, so the tenant service cannot see them; this guard is ours.
    const members = await gateway<Page<Student>>(`/user/v1/tenants/${tenantId}/students?batch_id=${id}&limit=1`);
    if (members.items.length > 0) return { error: "This batch still has students. Move them to another batch first." };
    await gateway(`/tenant/v1/tenants/${tenantId}/batches/${id}`, { method: "DELETE", body: { reason: reason.trim() } });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/departments");
  return { error: null, message: "Deleted." };
}

const REASON = "A reason is needed to delete anything.";

/** Renames or recodes a department. Only what changed is sent (ADR-0054). */
export async function updateDepartment(collegeId: string, departmentId: string, changes: Record<string, string>): Promise<ActionState> {
  const tenantId = collegeFor(await requireStaff());
  const body: Record<string, string> = {};
  if ("name" in changes) body.name = changes.name!.trim();
  if ("code" in changes) body.code = changes.code!.trim().toUpperCase();
  try {
    await gateway(`/tenant/v1/tenants/${tenantId}/departments/${departmentId}`, { method: "PATCH", body });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/departments");
  return { error: null, message: "Saved." };
}

export async function updateBatch(collegeId: string, batchId: string, changes: Record<string, string>): Promise<ActionState> {
  const tenantId = collegeFor(await requireStaff());
  const body: Record<string, string> = {};
  if ("name" in changes) body.name = changes.name!.trim();
  if ("code" in changes) body.code = changes.code!.trim().toUpperCase();
  if ("academic_year" in changes) body.academic_year = changes.academic_year!.trim();
  try {
    await gateway(`/tenant/v1/tenants/${tenantId}/batches/${batchId}`, { method: "PATCH", body });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/departments");
  revalidatePath("/staff/students");
  return { error: null, message: "Saved." };
}

export async function updatePlacementOrganization(organizationId: string, changes: Record<string, string>): Promise<ActionState> {
  const staff = await requireCollege();
  if (!staff.isPlatformAdmin) return { error: "Only platform administrators change placement organizations." };
  try {
    await gateway(`/tenant/v1/placement-organizations/${organizationId}`, { method: "PATCH", body: { legal_name: changes.legal_name?.trim() } });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/departments");
  return { error: null, message: "Saved." };
}

/** Root administrators only: it removes the organization and, with it, the placement departments under it. */
export async function deletePlacementOrganization(organizationId: string, reason: string): Promise<ActionState> {
  const staff = await requireCollege();
  if (!staff.isPlatformAdmin) return { error: "Only platform administrators delete placement organizations." };
  if (!reason.trim()) return { error: REASON };
  try {
    await gateway(`/tenant/v1/placement-organizations/${organizationId}`, { method: "DELETE", body: { reason: reason.trim() } });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/departments");
  return { error: null, message: "Deleted." };
}
