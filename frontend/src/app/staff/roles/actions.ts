"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import { actionError } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { collegeFor, requireStaff } from "@/lib/server/staff";

export async function createRole(_: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireStaff();
  const tenantId = collegeFor(staff);
  if (!staff.canManageAccounts) return { error: "Only administrators manage roles." };
  const name = (form.get("name") as string)?.trim();
  if (!name) return { error: "A role needs a name." };
  const tier = Number(form.get("tier") ?? 2);
  const position = Number(form.get("position") ?? 0);
  const permissions = form.getAll("permission") as string[];
  try {
    await gateway(`/user/v1/tenants/${tenantId}/roles`, {
      method: "POST",
      body: { name, tier, position, permissions },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/roles");
  return { error: null, message: `Role "${name}" created.` };
}

export async function updateRole(_: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireStaff();
  const tenantId = collegeFor(staff);
  if (!staff.canManageAccounts) return { error: "Only administrators manage roles." };
  const roleId = form.get("role_id") as string;
  const name = (form.get("name") as string)?.trim() || undefined;
  const permissions = form.has("permission") ? (form.getAll("permission") as string[]) : undefined;
  const position = form.has("position") ? Number(form.get("position")) : undefined;
  try {
    await gateway(`/user/v1/tenants/${tenantId}/roles/${roleId}`, {
      method: "PATCH",
      body: { name, position, permissions },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/roles");
  return { error: null, message: "Role updated." };
}

export async function deleteRole(_: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireStaff();
  const tenantId = collegeFor(staff);
  if (!staff.canManageAccounts) return { error: "Only administrators manage roles." };
  const roleId = form.get("role_id") as string;
  try {
    await gateway(`/user/v1/tenants/${tenantId}/roles/${roleId}`, { method: "DELETE" });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/roles");
  return { error: null, message: "Role deleted." };
}
