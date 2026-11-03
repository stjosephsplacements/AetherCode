import "server-only";
import { redirect } from "next/navigation";
import type { Page, Tenant } from "@/lib/api-types";
import { type Viewer, homeFor } from "@/lib/viewer";
import { gateway } from "./gateway";
import type { CollegeRef } from "./staff";
import { requireViewer } from "./session";

export type PlacementContext = {
  viewer: Viewer;
  isPlatformAdmin: boolean;
  /** The colleges this member's placement departments reach. A platform administrator reaches all of them. */
  colleges: CollegeRef[];
};

/** The placement area: placement staff and platform administrators. Everyone else goes back to their own area. */
export async function requirePlacement(): Promise<PlacementContext> {
  const viewer = await requireViewer();
  const isPlatformAdmin = viewer.roles.includes("super_admin");
  if (!isPlatformAdmin && !viewer.roles.includes("placement_user")) redirect(homeFor(viewer));
  const colleges = isPlatformAdmin
    ? (await gateway<Page<Tenant>>("/tenant/v1/tenants?limit=100")).items.map((tenant) => ({ id: tenant.id, name: tenant.display_name }))
    : viewer.tenantId
      ? [{ id: viewer.tenantId, name: "" }]
      : [];
  return { viewer, isPlatformAdmin, colleges };
}
