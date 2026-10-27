"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import { actionError } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { requireCollege } from "@/lib/server/staff";

export type StaffState = ActionState & { created?: { username: string; name: string; password: string } };

export async function createStaff(_previous: StaffState, form: FormData): Promise<StaffState> {
  const { tenantId } = await requireCollege();
  const role = String(form.get("role"));
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const name = String(form.get("display_name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  try {
    const result = await gateway<{ password: string }>(`/user/v1/tenants/${tenantId}/staff`, {
      method: "POST",
      body: {
        username,
        display_name: name,
        role,
        ...(email ? { email } : {}),
        ...(role === "department_user" ? { department_id: String(form.get("department_id")) } : {}),
      },
    });
    return { error: null, message: `${name} can now sign in as ${username}.`, created: { username, name, password: result.password } };
  } catch (error) {
    return { error: actionError(error) };
  }
}

/**
 * Gives a staff member another role: college administrator, faculty of a
 * department, or mentor of one or more batches at once.
 */
export async function grantRole(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  const principalId = String(form.get("principal_id") ?? "");
  const role = String(form.get("role") ?? "");
  const scopes =
    role === "college_admin"
      ? [{ scope_kind: "college", scope_id: tenantId }]
      : role === "department_user"
        ? [{ scope_kind: "department", scope_id: String(form.get("department_id") ?? "") }]
        : role === "mentor"
          ? form.getAll("batch_id").map((batch) => ({ scope_kind: "batch", scope_id: String(batch) }))
          : role === "placement_user"
            ? [{ scope_kind: "placement_department", scope_id: String(form.get("placement_department_id") ?? "") }]
            : [];
  if (!principalId || scopes.length === 0 || scopes.some((scope) => !scope.scope_id)) {
    return { error: role === "mentor" ? "Choose at least one batch." : "Choose a role and where it applies." };
  }
  try {
    for (const scope of scopes) {
      if (role === "placement_user") {
        await gateway(`/user/v1/placement-departments/${scope.scope_id}/staff/${principalId}`, {
          method: "PUT",
          body: {},
        });
      } else {
        await gateway("/user/v1/role-assignments", {
          method: "POST",
          body: { principal_id: principalId, role_name: role, tenant_id: tenantId, ...scope },
        });
        if (role === "mentor") {
          await gateway(`/user/v1/tenants/${tenantId}/batches/${scope.scope_id}/mentors/${principalId}`, { method: "PUT" });
        }
      }
    }
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/accounts");
  return { error: null, message: scopes.length > 1 ? `Role given for ${scopes.length} batches.` : "Role given." };
}

export async function revokeRole(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  try {
    await gateway(`/user/v1/role-assignments/${String(form.get("role_assignment_id"))}/revoke`, { method: "POST", body: { tenant_id: tenantId } });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/accounts");
  return { error: null, message: "Role removed." };
}
