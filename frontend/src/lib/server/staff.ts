import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Page, Tenant } from "@/lib/api-types";
import { type Viewer, isStaff } from "@/lib/viewer";
import { gateway } from "./gateway";
import { requireViewer } from "./session";

export const TENANT_COOKIE = "ac_tenant";

export type StaffContext = {
  viewer: Viewer;
  /** The college staff act in; null only for a platform administrator who has not picked one. */
  tenantId: string | null;
  /** Colleges a platform administrator can switch between. */
  tenants: Tenant[];
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
    return { viewer, tenantId: viewer.tenantId, tenants: [], isPlatformAdmin, canManageAccounts };
  }
  const page = await gateway<Page<Tenant>>("/tenant/v1/tenants?limit=100");
  const chosen = (await cookies()).get(TENANT_COOKIE)?.value;
  const tenantId = page.items.find((tenant) => tenant.id === chosen)?.id ?? page.items[0]?.id ?? null;
  return { viewer, tenantId, tenants: page.items, isPlatformAdmin, canManageAccounts };
}

/** requireStaff, for pages that need a college. */
export async function requireCollege(): Promise<StaffContext & { tenantId: string }> {
  const staff = await requireStaff();
  if (!staff.tenantId) redirect("/staff");
  return staff as StaffContext & { tenantId: string };
}
