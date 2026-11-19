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

const MAX_COLLEGE_PAGES = 100;

/** Every college, following the cursor so a deployment with more than one page of colleges loses none. */
async function listAllColleges(): Promise<CollegeRef[]> {
  const colleges: CollegeRef[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_COLLEGE_PAGES; page++) {
    const result = await gateway<Page<Tenant>>(`/tenant/v1/tenants?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    colleges.push(...result.items.map((tenant) => ({ id: tenant.id, name: tenant.display_name })));
    if (!result.next_cursor) return colleges;
    cursor = result.next_cursor;
  }
  throw new Error(`more than ${MAX_COLLEGE_PAGES} pages of colleges`);
}

/** The placement area: placement staff and platform administrators. Everyone else goes back to their own area. */
export async function requirePlacement(): Promise<PlacementContext> {
  const viewer = await requireViewer();
  const isPlatformAdmin = viewer.roles.includes("super_admin");
  if (!isPlatformAdmin && !viewer.roles.includes("placement_user")) redirect(homeFor(viewer));
  let allColleges = reachesAllColleges(viewer);
  let colleges: CollegeRef[] = viewer.tenantId ? [{ id: viewer.tenantId, name: "" }] : [];
  if (allColleges) {
    try {
      colleges = await listAllColleges();
    } catch (error) {
      // An administrator's failure is real; an officer whose role may not list colleges keeps their own, and the
      // context says so (allColleges false) so the UI does not claim a scope the pages are not loading.
      if (isPlatformAdmin) throw error;
      console.error("could not list colleges for placement:", error);
      allColleges = false;
    }
  }
  const canViewPII = isPlatformAdmin || viewer.roles.includes("placement_user") || viewer.roles.includes("college_admin");
  return { viewer, isPlatformAdmin, colleges, allColleges, canViewPII };
}
