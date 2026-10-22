"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import type { Batch, IssuedCredential, Page, StudentImportResult } from "@/lib/api-types";
import { actionError } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { requireCollege } from "@/lib/server/staff";

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
  const { tenantId } = await requireCollege();
  let rows: StudentRow[];
  try {
    rows = parseRows(String(form.get("csv") ?? ""));
  } catch (error) {
    return { error: (error as Error).message };
  }
  if (rows.length === 0) return { error: "Paste or upload at least one student." };
  if (rows.length > MAX_ROWS) return { error: `Import at most ${MAX_ROWS} students at a time.` };
  const batchId = String(form.get("batch_id") ?? "");
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
  const { tenantId } = await requireCollege();
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
  const { tenantId } = await requireCollege();
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
  const { tenantId } = await requireCollege();
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
