import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Page, Tenant } from "@/lib/api-types";
import { type Viewer, homeFor, isPlacementOnly, isStaff } from "@/lib/viewer";
import { gateway } from "./gateway";
import { requireViewer } from "./session";

export const TENANT_COOKIE = "ac_tenant";

export type StaffContext = {
  viewer: Viewer;
  /** The college staff act in; null only for a platform administrator who has not opened one. */
  tenantId: string | null;
  /** Every college: filled only by requireAdmin. */
  tenants: Tenant[];
  /** True only in the admin console, which covers every college. */
  viewAll: boolean;
  isPlatformAdmin: boolean;
  /** College administrators manage students, staff and departments. */
  canManageAccounts: boolean;
};

/**
 * The signed-in staff member and the one college they are working in. A platform administrator
 * works in a college only after opening it from /admin (the admin/open route sets the cookie);
 * until then `tenantId` is null and the /staff layout sends them to /admin.
 */
export async function requireStaff(): Promise<StaffContext> {
  const viewer = await requireViewer();
  if (!isStaff(viewer)) redirect("/student");
  // Placement-only staff have their own area; /staff is a college workspace.
  if (isPlacementOnly(viewer)) redirect("/placement");
  const isPlatformAdmin = viewer.roles.includes("super_admin");
  const canManageAccounts = isPlatformAdmin || viewer.roles.includes("college_admin");
  const tenantId = isPlatformAdmin ? ((await cookies()).get(TENANT_COOKIE)?.value ?? null) : viewer.tenantId;
  return { viewer, tenantId, tenants: [], viewAll: false, isPlatformAdmin, canManageAccounts };
}

/** The admin console: platform administrators only, with every college. Everyone else goes back to their own area. */
export async function requireAdmin(): Promise<StaffContext> {
  const viewer = await requireViewer();
  if (!viewer.roles.includes("super_admin")) redirect(homeFor(viewer));
  const page = await gateway<Page<Tenant>>("/tenant/v1/tenants?limit=100");
  return { viewer, tenantId: null, tenants: page.items, viewAll: true, isPlatformAdmin: true, canManageAccounts: true };
}

/** requireStaff, for pages that need a college. */
export async function requireCollege(): Promise<StaffContext & { tenantId: string }> {
  const staff = await requireStaff();
  if (!staff.tenantId) redirect("/admin");
  return staff as StaffContext & { tenantId: string };
}

export type CollegeRef = { id: string; name: string };

/** The colleges a /staff list covers: the one the member works in. Cross-college lists live in /admin and /placement. */
export function collegesFor(staff: StaffContext): CollegeRef[] {
  return staff.tenantId ? [{ id: staff.tenantId, name: "" }] : [];
}

/** The college a change targets: always the one the member works in, whatever is sent. */
export function collegeFor(staff: StaffContext): string {
  if (!staff.tenantId) redirect("/admin");
  return staff.tenantId;
}
