import "server-only";
import type { Batch, Department, PlacementOrganization } from "@/lib/api-types";
import { fetchAllPages } from "./fetch-all";
import { GatewayError } from "./gateway";

export function listDepartments(tenantId: string): Promise<Department[]> {
  return fetchAllPages<Department>(`/tenant/v1/tenants/${tenantId}/departments`);
}

export function listBatches(tenantId: string): Promise<Batch[]> {
  return fetchAllPages<Batch>(`/tenant/v1/tenants/${tenantId}/batches`);
}

export type PlacementDirectory = {
  organizations: (PlacementOrganization & { departments: Department[] })[];
  /** False when the role may not list placement organizations (they are global). */
  readable: boolean;
};

export async function listPlacement(): Promise<PlacementDirectory> {
  try {
    const organizations = await fetchAllPages<PlacementOrganization>("/tenant/v1/placement-organizations");
    const withDepartments = await Promise.all(
      organizations.map(async (organization) => ({
        ...organization,
        departments: await fetchAllPages<Department>(`/tenant/v1/placement-organizations/${organization.id}/departments`),
      })),
    );
    return { organizations: withDepartments, readable: true };
  } catch (error) {
    if (error instanceof GatewayError && error.status === 403) return { organizations: [], readable: false };
    throw error;
  }
}

/** "CSE (Computer Science)"-style labels for selects. */
export function departmentLabel(department: Department): string {
  return `${department.name} (${department.code})`;
}
