"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import type { Batch, IssuedCredential, Page, StudentImportResult } from "@/lib/api-types";
import { actionError } from "@/lib/server/actions";
import { GatewayError, gateway } from "@/lib/server/gateway";
import { collegeFor, requireStaff } from "@/lib/server/staff";

export type ImportState = ActionState & { result?: StudentImportResult };
export type CredentialsState = ActionState & { accounts?: IssuedCredential[] };

type StudentRow = { roll_number: string; name: string; email?: string };

const MAX_ROWS = 500;

/** Parses "roll_number,name[,email]" lines; a header row is skipped. */
function parseRows(csv: string): StudentRow[] {
  const rows: StudentRow[] = [];
  for (const [index, rawLine] of csv.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const cells = line.split(",").map((cell) => cell.trim().replace(/^"(.*)"$/, "$1"));
    if (index === 0 && /roll/i.test(cells[0] ?? "")) continue;
    const [roll_number = "", name = "", email = ""] = cells;
    if (!roll_number || !name) throw new Error(`Line ${index + 1} needs a roll number and a name.`);
    rows.push(email ? { roll_number, name, email } : { roll_number, name });
  }
  return rows;
}

export async function importStudents(_previous: ImportState, form: FormData): Promise<ImportState> {
  // The batch picker lists every college's batches as "<college>:<batch>", so students land in that batch's own college.
  const pickedCollege = String(form.get("batch_id") ?? "").includes(":") ? String(form.get("batch_id")).split(":")[0] : String(form.get("college_id") ?? "");
  const tenantId = collegeFor(await requireStaff(), pickedCollege);
  let rows: StudentRow[];
  try {
    rows = parseRows(String(form.get("csv") ?? ""));
  } catch (error) {
    return { error: (error as Error).message };
  }
  if (rows.length === 0) return { error: "Paste or upload at least one student." };
  if (rows.length > MAX_ROWS) return { error: `Import at most ${MAX_ROWS} students at a time.` };
  const batchId = String(form.get("batch_id") ?? "").split(":").pop() ?? "";
  try {
    const batches = await gateway<Page<Batch>>(`/tenant/v1/tenants/${tenantId}/batches?limit=100`);
    const batch = batches.items.find((candidate) => candidate.id === batchId);
    if (!batch) return { error: "Choose a batch." };
    const result = await gateway<StudentImportResult>(`/user/v1/tenants/${tenantId}/students/import`, {
      method: "POST",
      body: {
        batch_id: batch.id,
        college_department_id: batch.department_id,
        placement_department_id: String(form.get("placement_department_id") ?? ""),
        students: rows,
      },
    });
    revalidatePath("/staff/students");
    return {
      error: null,
      message: `${result.imported.length} imported${result.skipped.length ? `, ${result.skipped.length} already existed and were skipped` : ""}.`,
      result,
    };
  } catch (error) {
    return { error: actionError(error) };
  }
}

export async function reissueBatchPasswords(_previous: CredentialsState, form: FormData): Promise<CredentialsState> {
  const tenantId = collegeFor(await requireStaff(), String(form.get("college_id") ?? ""));
  try {
    const result = await gateway<{ accounts: IssuedCredential[] }>(
      `/user/v1/tenants/${tenantId}/batches/${String(form.get("batch_id"))}/passwords`,
      { method: "POST" },
    );
    return { error: null, message: `New passwords for ${result.accounts.length} students. Old passwords no longer work.`, accounts: result.accounts };
  } catch (error) {
    return { error: actionError(error) };
  }
}

export async function resetPassword(_previous: CredentialsState, form: FormData): Promise<CredentialsState> {
  const tenantId = collegeFor(await requireStaff(), String(form.get("college_id") ?? ""));
  const principalId = String(form.get("principal_id"));
  try {
    const result = await gateway<{ password: string }>(`/user/v1/tenants/${tenantId}/accounts/${principalId}/password`, { method: "POST" });
    return {
      error: null,
      accounts: [{ principal_id: principalId, username: String(form.get("username") ?? ""), display_name: "", password: result.password }],
    };
  } catch (error) {
    return { error: actionError(error) };
  }
}

export async function setAccountStatus(_previous: ActionState, form: FormData): Promise<ActionState> {
  const tenantId = collegeFor(await requireStaff(), String(form.get("college_id") ?? ""));
  const status = String(form.get("status"));
  try {
    await gateway(`/user/v1/tenants/${tenantId}/accounts/${String(form.get("principal_id"))}/status`, {
      method: "PUT",
      body: { status },
    });
    return { error: null, message: status === "disabled" ? "Sign-in disabled." : "Sign-in enabled." };
  } catch (error) {
    return { error: actionError(error) };
  }
}

export async function updateStudent(collegeId: string, studentId: string, changes: Record<string, string>): Promise<ActionState> {
  const tenantId = collegeFor(await requireStaff(), collegeId);
  const body: Record<string, string> = {};
  if ("enrollment_number" in changes) body.enrollment_number = changes.enrollment_number!.trim();
  if ("admitted_at" in changes) body.admitted_at = changes.admitted_at!.trim();
  try {
    await gateway(`/user/v1/tenants/${tenantId}/students/${studentId}`, { method: "PATCH", body });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/students");
  return { error: null, message: "Saved." };
}

/** Changes an account's name, email or phone (ADR-0057). Only the fields sent change; empty clears an email or phone. */
export async function updateAccount(collegeId: string, principalId: string, changes: Record<string, string>): Promise<ActionState> {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) return { error: "Only administrators edit accounts." };
  const tenantId = collegeFor(staff, collegeId);
  const body: Record<string, string> = {};
  for (const key of ["display_name", "email", "phone"]) if (key in changes) body[key] = changes[key]!.trim();
  if (Object.keys(body).length === 0) return { error: "Nothing to change." };
  try {
    await gateway(`/user/v1/tenants/${tenantId}/accounts/${principalId}`, { method: "PATCH", body });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/students");
  return { error: null, message: "Saved." };
}

/** Removes a student record. Their sign-in can be turned off instead, which is easy to undo. */
export async function deleteStudent(collegeId: string, studentId: string, reason: string): Promise<ActionState> {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) return { error: "Only administrators delete students." };
  const tenantId = collegeFor(staff, collegeId);
  if (!reason.trim()) return { error: "A reason is needed to delete anything." };
  try {
    await gateway(`/user/v1/tenants/${tenantId}/students/${studentId}`, { method: "DELETE", body: { reason: reason.trim() } });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/students");
  return { error: null, message: "Deleted." };
}

export type Target = { principalId: string; collegeId: string; username: string };

/** Groups a selection by college, since the bulk routes act inside one college. */
function byCollege(targets: Target[], staff: Awaited<ReturnType<typeof requireStaff>>): Map<string, Target[]> {
  const groups = new Map<string, Target[]>();
  for (const target of targets) {
    const tenantId = collegeFor(staff, target.collegeId);
    groups.set(tenantId, [...(groups.get(tenantId) ?? []), target]);
  }
  return groups;
}

/** A user service from before the one-call routes answers 404; the same work is then done one account at a time. */
const missingRoute = (error: unknown) => error instanceof GatewayError && error.status === 404;

export async function bulkSetStatus(targets: Target[], status: "active" | "disabled"): Promise<ActionState> {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) return { error: "Only administrators change accounts." };
  if (targets.length === 0 || targets.length > 500) return { error: "Select between 1 and 500 students." };
  let done = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (const [tenantId, group] of byCollege(targets, staff)) {
    try {
      try {
        await gateway(`/user/v1/tenants/${tenantId}/accounts/bulk-status`, { method: "POST", body: { principal_ids: group.map((target) => target.principalId), status } });
      } catch (error) {
        if (!missingRoute(error)) throw error;
        for (const target of group) await gateway(`/user/v1/tenants/${tenantId}/accounts/${target.principalId}/status`, { method: "PUT", body: { status } });
      }
      done += group.length;
    } catch (error) {
      failed += group.length;
      firstError ??= actionError(error);
    }
  }
  revalidatePath("/staff/students");
  if (done === 0) return { error: firstError ?? "Could not change any of them." };
  const verb = status === "disabled" ? "disabled" : "enabled";
  return { error: null, message: `Sign-in ${verb} for ${done}${failed ? `, ${failed} failed (${firstError})` : ""}.` };
}

export async function bulkResetPasswords(targets: Target[]): Promise<CredentialsState> {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) return { error: "Only administrators change accounts." };
  if (targets.length === 0 || targets.length > 500) return { error: "Select between 1 and 500 students." };
  const accounts: IssuedCredential[] = [];
  let failed = 0;
  let firstError: string | null = null;
  for (const [tenantId, group] of byCollege(targets, staff)) {
    try {
      try {
        const result = await gateway<{ accounts: IssuedCredential[] }>(`/user/v1/tenants/${tenantId}/accounts/bulk-password`, { method: "POST", body: { principal_ids: group.map((target) => target.principalId) } });
        accounts.push(...result.accounts);
      } catch (error) {
        if (!missingRoute(error)) throw error;
        for (const target of group) {
          const result = await gateway<{ password: string }>(`/user/v1/tenants/${tenantId}/accounts/${target.principalId}/password`, { method: "POST" });
          accounts.push({ principal_id: target.principalId, username: target.username, display_name: "", password: result.password });
        }
      }
    } catch (error) {
      failed += group.length;
      firstError ??= actionError(error);
    }
  }
  if (accounts.length === 0) return { error: firstError ?? "Could not reset any of them." };
  return { error: null, message: failed ? `${failed} could not be reset (${firstError}).` : undefined, accounts };
}
