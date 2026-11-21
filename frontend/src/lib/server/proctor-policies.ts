import "server-only";
import type { Page, ProctorPolicy, ProctorPolicyVersion } from "@/lib/api-types";
import { gateway } from "./gateway";

export function assessmentBase(tenantId: string): string {
  return `/assessment/v1/tenants/${tenantId}`;
}

async function walkPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let cursor = "";
  for (let page = 0; page < 50; page++) {
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const pageResult = await gateway<Page<T>>(`${path}${suffix}`);
    items.push(...pageResult.items);
    if (!pageResult.next_cursor) return items;
    cursor = pageResult.next_cursor;
  }
  return items;
}

export async function listAllProctorPolicies(tenantId: string): Promise<ProctorPolicy[]> {
  return walkPages(`${assessmentBase(tenantId)}/proctor-policies?limit=100`);
}

export async function listProctorPolicyVersions(
  tenantId: string,
  policyId: string,
  status?: "draft" | "published",
): Promise<ProctorPolicyVersion[]> {
  const filter = status ? `&status=${status}` : "";
  return walkPages(
    `${assessmentBase(tenantId)}/proctor-policies/${encodeURIComponent(policyId)}/versions?limit=100${filter}`,
  );
}

/** Published policy versions staff can attach when creating an exam. */
export async function listPublishedPolicyVersions(tenantId: string): Promise<{ id: string; label: string }[]> {
  const policies = await listAllProctorPolicies(tenantId);
  const groups = await Promise.all(
    policies.map(async (policy) => {
      const versions = await listProctorPolicyVersions(tenantId, policy.id, "published");
      return versions.map((version) => ({
        id: version.id,
        label: `${policy.name} · v${version.version_number}`,
      }));
    }),
  );
  return groups.flat();
}