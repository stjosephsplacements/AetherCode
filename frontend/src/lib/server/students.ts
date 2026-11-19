import "server-only";
import type { Student } from "@/lib/api-types";
import { fetchAllPages } from "./fetch-all";
import { GatewayError } from "./gateway";

/** A student as the roster returns them: with the batch, profile name and the batch's mentors (ADR-0057). */
export type RosterStudent = Student & { batch_id?: string; profile_name?: string; mentor_principal_ids: string[] };

/**
 * Every student of a college through the roster read, following the cursor. A user service from
 * before the roster route answers 404 or 400; the students are then read all at once and matched to batches, without mentors.
 */
export async function listRoster(tenantId: string, batchIds: string[]): Promise<RosterStudent[]> {
  try {
    return await fetchAllPages<RosterStudent>(`/user/v1/tenants/${tenantId}/students/roster`);
  } catch (error) {
    // The old service reads "roster" as a student id and answers 400, not 404.
    if (!(error instanceof GatewayError && (error.status === 404 || error.status === 400))) throw error;
  }
  // Every student, then which batch each is in; a student enrolled without a batch affiliation shows under "No batch".
  const [everyone, perBatch] = await Promise.all([
    listAllStudents(tenantId),
    Promise.all(batchIds.map(async (batchId) => (await listAllStudents(tenantId, batchId)).map((student) => [student.id, batchId] as const))),
  ]);
  const batchOf = new Map(perBatch.flat());
  return everyone.map((student) => ({ ...student, batch_id: batchOf.get(student.id), mentor_principal_ids: [] }));
}

/** Every student of a college (or one batch), following the cursor. */
export function listAllStudents(tenantId: string, batchId?: string): Promise<Student[]> {
  return fetchAllPages<Student>(`/user/v1/tenants/${tenantId}/students${batchId ? `?batch_id=${batchId}` : ""}`);
}
