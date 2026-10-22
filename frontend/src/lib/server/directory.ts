import "server-only";
import type { Batch, Department, Page, PlacementOrganization } from "@/lib/api-types";
import { GatewayError, gateway } from "./gateway";

export async function listDepartments(tenantId: string): Promise<Department[]> {
  return (await gateway<Page<Department>>(`/tenant/v1/tenants/${tenantId}/departments?limit=100`)).items;
}

export async function listBatches(tenantId: string): Promise<Batch[]> {
  return (await gateway<Page<Batch>>(`/tenant/v1/tenants/${tenantId}/batches?limit=100`)).items;
}

export type PlacementDirectory = {
  organizations: (PlacementOrganization & { departments: Department[] })[];
  /** False when the role may not list placement organizations (they are global). */
  readable: boolean;
};

export async function listPlacement(): Promise<PlacementDirectory> {
  try {
    const organizations = (await gateway<Page<PlacementOrganization>>("/tenant/v1/placement-organizations?limit=100")).items;
    const withDepartments = await Promise.all(
      organizations.map(async (organization) => ({
        ...organization,
        departments: (await gateway<Page<Department>>(`/tenant/v1/placement-organizations/${organization.id}/departments?limit=100`)).items,
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
