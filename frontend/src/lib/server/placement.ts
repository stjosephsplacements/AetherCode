import "server-only";
import { redirect } from "next/navigation";
import type { Page, Tenant } from "@/lib/api-types";
import { type Viewer, canViewStudentPII, homeFor, reachesAllColleges } from "@/lib/viewer";
import { gateway } from "./gateway";
import type { CollegeRef } from "./staff";
import { requireViewer } from "./session";

export type PlacementContext = {
  viewer: Viewer;
  isPlatformAdmin: boolean;
  /** Placement departments this officer is assigned to. */
  departmentIds: string[];
  /** The colleges this member reaches: all for a platform administrator or a platform-scoped officer, otherwise their own. */
  colleges: CollegeRef[];
  /** Whether the viewer's reach is every college (also gates managing placement departments and officers). */
  allColleges: boolean;
  /** Whether the viewer may see student names and roll numbers (VIEW_STUDENT_PII). */
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

/**
 * The placement staff console. Platform administrators set up org/tracks under
 * `/admin/placement` (ADR-0089); only `placement_user` works here.
 */
export async function requirePlacement(): Promise<PlacementContext> {
  const viewer = await requireViewer();
  const isPlatformAdmin = viewer.roles.includes("super_admin");
  if (isPlatformAdmin) redirect("/admin/placement");
  if (!viewer.roles.includes("placement_user")) redirect(homeFor(viewer));

  const departmentIds = viewer.placementDepartmentIds;
  let allColleges = reachesAllColleges(viewer);
  let colleges: CollegeRef[] = viewer.tenantId ? [{ id: viewer.tenantId, name: "" }] : [];
  if (allColleges) {
    try {
      colleges = await listAllColleges();
    } catch (error) {
      if (isPlatformAdmin) throw error;
      console.error("could not list colleges for placement:", error);
      allColleges = false;
    }
  } else {
    const tenants = (await gateway<Page<Tenant>>("/tenant/v1/tenants?limit=100").catch(() => ({ items: [] as Tenant[] }))).items;
    colleges = tenants.map((tenant) => ({ id: tenant.id, name: tenant.display_name }));
  }
  return { viewer, isPlatformAdmin, departmentIds, colleges, allColleges, canViewPII: canViewStudentPII(viewer) };
}