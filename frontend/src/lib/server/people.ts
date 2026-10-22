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
