import "server-only";
import { redirect } from "next/navigation";
import type { Page, Tenant } from "@/lib/api-types";
import { type Viewer, homeFor } from "@/lib/viewer";
import { gateway } from "./gateway";
import type { CollegeRef } from "./staff";
import { requireViewer } from "./session";

export type PlacementContext = {
  viewer: Viewer;
  /** Placement departments this officer is assigned to. */
  departmentIds: string[];
  /** Colleges the officer may pull students from (every college for scoped officers). */
  colleges: CollegeRef[];
  /** Whether the viewer may see student names and roll numbers. */
  canViewPII: boolean;
};

/**
 * The placement staff console. Platform administrators set up org/tracks under
 * `/admin/placement` (ADR-0089); only `placement_user` works here.
 */
export async function requirePlacement(): Promise<PlacementContext> {
  const viewer = await requireViewer();
  if (viewer.roles.includes("super_admin")) redirect("/admin/placement");
  if (!viewer.roles.includes("placement_user")) redirect(homeFor(viewer));

  const departmentIds = viewer.placementDepartmentIds;
  const tenants = (await gateway<Page<Tenant>>("/tenant/v1/tenants?limit=100").catch(() => ({ items: [] as Tenant[] }))).items;
  const colleges = tenants.map((tenant) => ({ id: tenant.id, name: tenant.display_name }));
  const canViewPII = true;
  return { viewer, departmentIds, colleges, canViewPII };
}
