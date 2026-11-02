import "server-only";
import type { AccountSummary, Page, RoleAssignment } from "@/lib/api-types";
import { gateway } from "./gateway";

/** Names this college's accounts by principal ID (ADR-0043); unknown IDs are left out. */
export async function describeAccounts(tenantId: string, principalIds: string[]): Promise<Map<string, AccountSummary>> {
  const unique = [...new Set(principalIds)];
  const named = new Map<string, AccountSummary>();
  for (let start = 0; start < unique.length; start += 500) {
    const chunk = unique.slice(start, start + 500);
    const summaries = await gateway<AccountSummary[]>(`/user/v1/tenants/${tenantId}/accounts/describe`, {
      method: "POST",
      body: { principal_ids: chunk },
    });
    for (const summary of summaries) named.set(summary.principal_id, summary);
  }
  return named;
}

/** Every role assignment in a college, following the cursor (up to 2000). */
export async function listRoleAssignments(tenantId: string): Promise<RoleAssignment[]> {
  const assignments: RoleAssignment[] = [];
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const result = await gateway<Page<RoleAssignment>>(`/user/v1/role-assignments?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, {
      headers: { "X-Tenant-ID": tenantId },
    });
    assignments.push(...result.items);
    if (!result.next_cursor) break;
    cursor = result.next_cursor;
  }
  return assignments;
}

export type SuperAdmin = { assignmentId: string; principalId: string; root: boolean; name: string; username: string };

/**
 * Every active platform administrator. They belong to no college, so each is named from
 * the first college that knows them, or from the signed-in account itself.
 */
export async function listSuperAdmins(colleges: { id: string }[], me: { principalId: string; displayName: string; username: string }): Promise<SuperAdmin[]> {
  const result = await gateway<Page<RoleAssignment>>("/user/v1/role-assignments?limit=100&role_name=super_admin&scope_kind=platform");
  const active = result.items.filter((assignment) => assignment.status === "active");
  const named = new Map<string, AccountSummary>();
  for (const college of colleges) {
    const missing = active.map((assignment) => assignment.principal_id).filter((id) => !named.has(id));
    if (missing.length === 0) break;
    for (const [id, summary] of await describeAccounts(college.id, missing).catch(() => new Map<string, AccountSummary>())) named.set(id, summary);
  }
  return active
    .map((assignment) => {
      const summary = named.get(assignment.principal_id);
      const self = assignment.principal_id === me.principalId;
      return {
        assignmentId: assignment.id,
        principalId: assignment.principal_id,
        root: assignment.root === true,
        name: summary?.display_name ?? (self ? me.displayName : "Platform administrator"),
        username: summary?.username ?? (self ? me.username : ""),
      };
    })
    .sort((a, b) => Number(b.root) - Number(a.root) || a.name.localeCompare(b.name));
}
