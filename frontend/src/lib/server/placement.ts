import "server-only";
import { redirect } from "next/navigation";
import type { Page, Tenant } from "@/lib/api-types";
import { type Viewer, homeFor, reachesAllColleges } from "@/lib/viewer";
import { gateway } from "./gateway";
import type { CollegeRef } from "./staff";
import { requireViewer } from "./session";

export type PlacementContext = {
  viewer: Viewer;
  isPlatformAdmin: boolean;
  /** The colleges this member reaches: all for a platform administrator or a platform-scoped officer, otherwise their own. */
  colleges: CollegeRef[];
  /** Whether the viewer's reach is every college (also gates managing placement departments and officers). */
  allColleges: boolean;
  /** Whether the viewer may see student names and roll numbers. False for future read-only dashboard viewers. */
  canViewPII: boolean;
};

/** The placement area: placement staff and platform administrators. Everyone else goes back to their own area. */
export async function requirePlacement(): Promise<PlacementContext> {
  const viewer = await requireViewer();
  const isPlatformAdmin = viewer.roles.includes("super_admin");
  if (!isPlatformAdmin && !viewer.roles.includes("placement_user")) redirect(homeFor(viewer));
  const allColleges = reachesAllColleges(viewer);
  let colleges: CollegeRef[] = viewer.tenantId ? [{ id: viewer.tenantId, name: "" }] : [];
  if (allColleges) {
    try {
      colleges = (await gateway<Page<Tenant>>("/tenant/v1/tenants?limit=100")).items.map((tenant) => ({ id: tenant.id, name: tenant.display_name }));
    } catch (error) {
      // An administrator's failure is real; an officer whose role may not list colleges keeps their own.
      if (isPlatformAdmin) throw error;
      console.error("could not list colleges for placement:", error);
    }
  }
  const canViewPII = isPlatformAdmin || viewer.roles.includes("placement_user") || viewer.roles.includes("college_admin");
  return { viewer, isPlatformAdmin, colleges, allColleges, canViewPII };
}
