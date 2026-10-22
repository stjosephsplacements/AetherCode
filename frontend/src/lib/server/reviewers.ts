import "server-only";
import { describeAccounts, listRoleAssignments } from "./people";

export type ReviewerChoice = { id: string; name: string };

/**
 * Staff of the college other than the caller, for naming a reviewer. Listing
 * role assignments needs a role the caller may not have, so any failure means
 * no choices and the request goes to every reviewer.
 */
export async function reviewerChoices(tenantId: string | null, selfId: string): Promise<ReviewerChoice[]> {
  if (!tenantId) return [];
  try {
    const staffIds = [...new Set((await listRoleAssignments(tenantId)).filter((assignment) => assignment.role_name !== "student" && assignment.status === "active").map((assignment) => assignment.principal_id))].filter((id) => id !== selfId);
    const names = await describeAccounts(tenantId, staffIds);
    return staffIds.map((id) => ({ id, name: names.get(id)?.display_name ?? id })).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
