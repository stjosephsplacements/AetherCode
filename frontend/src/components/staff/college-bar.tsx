import { CollegeSelect } from "@/components/staff/college-select";
import type { StaffContext } from "@/lib/server/staff";

/**
 * The college a page is showing, with a way to change it, for a root administrator
 * only: everyone else works in their own college. Pages that merge every college
 * pass `allowAll` and show "All colleges" when no single college is chosen.
 */
export function CollegeBar({ staff, allowAll = false }: { staff: StaffContext; allowAll?: boolean }) {
  if (!staff.isPlatformAdmin || staff.tenants.length === 0) return null;
  const current = allowAll && staff.viewAll ? "all" : (staff.tenantId ?? staff.tenants[0]!.id);
  return <CollegeSelect colleges={staff.tenants.map((tenant) => ({ id: tenant.id, name: tenant.display_name }))} current={current} allowAll={allowAll} />;
}
