import "server-only";
import type { Page, Student } from "@/lib/api-types";
import { gateway } from "./gateway";

/** A student as the roster returns them: with the batch, profile name and the batch's mentors (ADR-0057). */
export type RosterStudent = Student & { batch_id?: string; profile_name?: string; mentor_principal_ids: string[] };

/** Every student of a college through the roster read, following the cursor (up to 5000). */
export async function listRoster(tenantId: string): Promise<RosterStudent[]> {
  const students: RosterStudent[] = [];
  let cursor = "";
  for (let page = 0; page < 25; page++) {
    const result = await gateway<Page<RosterStudent>>(`/user/v1/tenants/${tenantId}/students/roster?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    students.push(...result.items);
    if (!result.next_cursor) break;
    cursor = result.next_cursor;
  }
  return students;
}

/** Every student of a college (or one batch), following the cursor (up to 5000). */
export async function listAllStudents(tenantId: string, batchId?: string): Promise<Student[]> {
  const students: Student[] = [];
  let cursor = "";
  for (let page = 0; page < 50; page++) {
    const result = await gateway<Page<Student>>(`/user/v1/tenants/${tenantId}/students?limit=100${batchId ? `&batch_id=${batchId}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    students.push(...result.items);
    if (!result.next_cursor) break;
    cursor = result.next_cursor;
  }
  return students;
}
