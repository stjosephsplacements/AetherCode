import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Page, Tenant } from "@/lib/api-types";
import { type Viewer, isStaff } from "@/lib/viewer";
import { gateway } from "./gateway";
import { requireViewer } from "./session";

export const TENANT_COOKIE = "ac_tenant";
export const ALL_COLLEGES = "all";

export type StaffContext = {
  viewer: Viewer;
  /** The college staff act in; null only for a platform administrator who has not picked one. */
  tenantId: string | null;
  /** Colleges a platform administrator can switch between. */
  tenants: Tenant[];
  /** A platform administrator who has not narrowed to one college sees every college's lists at once. */
  viewAll: boolean;
  isPlatformAdmin: boolean;
  /** College administrators manage students, staff and departments. */
  canManageAccounts: boolean;
};

/** The signed-in staff member and the college they are working in. */
export async function requireStaff(): Promise<StaffContext> {
  const viewer = await requireViewer();
  if (!isStaff(viewer)) redirect("/student");
  const isPlatformAdmin = viewer.roles.includes("super_admin");
  const canManageAccounts = isPlatformAdmin || viewer.roles.includes("college_admin");
  if (!isPlatformAdmin) {
    return { viewer, tenantId: viewer.tenantId, tenants: [], viewAll: false, isPlatformAdmin, canManageAccounts };
  }
  const page = await gateway<Page<Tenant>>("/tenant/v1/tenants?limit=100");
  const chosen = (await cookies()).get(TENANT_COOKIE)?.value;
  // Until a college is chosen, lists cover every college (the working college, for pages that need one, is the first).
  const tenantId = page.items.find((tenant) => tenant.id === chosen)?.id ?? page.items[0]?.id ?? null;
  const viewAll = chosen === undefined || chosen === ALL_COLLEGES || !page.items.some((tenant) => tenant.id === chosen);
  return { viewer, tenantId, tenants: page.items, viewAll, isPlatformAdmin, canManageAccounts };
}

/** requireStaff, for pages that need a college. */
export async function requireCollege(): Promise<StaffContext & { tenantId: string }> {
  const staff = await requireStaff();
  if (!staff.tenantId) redirect("/staff");
  return staff as StaffContext & { tenantId: string };
}
