"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import { actionError } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { collegeFor, requireStaff } from "@/lib/server/staff";
import { parseStaffLines } from "@/lib/staff-csv";

export type StaffState = ActionState & { created?: { username: string; name: string; password: string } };

export async function createStaff(_previous: StaffState, form: FormData): Promise<StaffState> {
  // A faculty member's department is listed as "<college>:<department>", so the account is created in the department's own college.
  const pickedDepartment = String(form.get("department_id") ?? "");
  const [, departmentId] = pickedDepartment.includes(":") ? pickedDepartment.split(":") : ["", pickedDepartment];
  const tenantId = collegeFor(await requireStaff());
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
        ...(role === "department_user" ? { department_id: departmentId } : {}),
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
  const tenantId = collegeFor(await requireStaff());
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
  const tenantId = collegeFor(await requireStaff());
  try {
    await gateway(`/user/v1/role-assignments/${String(form.get("role_assignment_id"))}/revoke`, { method: "POST", body: { tenant_id: tenantId } });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/accounts");
  return { error: null, message: "Role removed." };
}

export type StaffImportState = ActionState & { created?: { username: string; name: string; password: string }[]; failed?: string[] };

/** Adds many staff at once, one account per line. A line that fails does not stop the others. */
export async function importStaff(_previous: StaffImportState, form: FormData): Promise<StaffImportState> {
  const pickedDepartment = String(form.get("department_id") ?? "");
  const [, departmentId] = pickedDepartment.includes(":") ? pickedDepartment.split(":") : ["", pickedDepartment];
  const staff = await requireStaff();
  if (!staff.canManageAccounts) return { error: "Only administrators add staff." };
  const tenantId = collegeFor(staff);
  const role = String(form.get("role"));
  const { rows, problems } = parseStaffLines(String(form.get("csv") ?? ""));
  if (problems.length > 0) return { error: problems.slice(0, 5).join(" ") + (problems.length > 5 ? ` (and ${problems.length - 5} more)` : "") };
  if (rows.length === 0) return { error: "Paste or upload at least one person." };
  const created: { username: string; name: string; password: string }[] = [];
  const failed: string[] = [];
  for (const row of rows) {
    try {
      const result = await gateway<{ password: string }>(`/user/v1/tenants/${tenantId}/staff`, {
        method: "POST",
        body: { username: row.username, display_name: row.name, role, ...(row.email ? { email: row.email } : {}), ...(role === "department_user" ? { department_id: departmentId } : {}) },
      });
      created.push({ username: row.username, name: row.name, password: result.password });
    } catch (error) {
      failed.push(`${row.username}: ${actionError(error)}`);
    }
  }
  revalidatePath("/staff/accounts");
  if (created.length === 0) return { error: "Nobody was added.", failed };
  return { error: null, message: `${created.length} added${failed.length ? `, ${failed.length} failed` : ""}.`, created, failed };
}

/** Root only. Makes an existing staff member a delegated super admin, holding every permission until the root narrows them. */
export async function makeSuperAdmin(_previous: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireStaff();
  if (!staff.isPlatformAdmin) return { error: "Only platform administrators add super admins." };
  const principalId = String(form.get("principal_id") ?? "");
  if (!principalId) return { error: "Choose a person." };
  try {
    await gateway("/user/v1/role-assignments", { method: "POST", body: { principal_id: principalId, role_name: "super_admin", scope_kind: "platform" } });
    const catalogue = await gateway<{ permissions: { key: string }[] }>("/user/v1/permission-catalogue");
    await gateway(`/user/v1/staff/${principalId}/permissions`, { method: "PUT", body: { permissions: catalogue.permissions.map((permission) => permission.key) } });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/staff", "layout");
  return { error: null, message: "Super admin added. Narrow their permissions on the Permissions page." };
}

/** Root only. The root administrator itself cannot be removed (the database refuses). */
export async function removeSuperAdmin(_previous: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireStaff();
  if (!staff.isPlatformAdmin) return { error: "Only platform administrators remove super admins." };
  try {
    await gateway(`/user/v1/role-assignments/${String(form.get("role_assignment_id"))}/revoke`, { method: "POST", body: {} });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/staff", "layout");
  return { error: null, message: "Super admin removed." };
}
