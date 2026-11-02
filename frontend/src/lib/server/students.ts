import "server-only";
import type { Page, Student } from "@/lib/api-types";
import { GatewayError, gateway } from "./gateway";

/** A student as the roster returns them: with the batch, profile name and the batch's mentors (ADR-0057). */
export type RosterStudent = Student & { batch_id?: string; profile_name?: string; mentor_principal_ids: string[] };

/**
 * Every student of a college through the roster read, following the cursor (up to 5000). A user service from
 * before the roster route answers 404; the students are then read batch by batch, without mentors.
 */
export async function listRoster(tenantId: string, batchIds: string[]): Promise<RosterStudent[]> {
  const students: RosterStudent[] = [];
  let cursor = "";
  try {
    for (let page = 0; page < 25; page++) {
      const result = await gateway<Page<RosterStudent>>(`/user/v1/tenants/${tenantId}/students/roster?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      students.push(...result.items);
      if (!result.next_cursor) break;
      cursor = result.next_cursor;
    }
    return students;
  } catch (error) {
    if (!(error instanceof GatewayError && error.status === 404)) throw error;
  }
  const perBatch = await Promise.all(batchIds.map(async (batchId) => (await listAllStudents(tenantId, batchId)).map((student) => ({ ...student, batch_id: batchId, mentor_principal_ids: [] }))));
  return perBatch.flat();
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
