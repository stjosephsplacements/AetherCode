"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import { actionError } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { collegeFor, requireStaff } from "@/lib/server/staff";

/**
 * Replaces the extra permissions one person holds, in this college or, for a root
 * administrator, across the platform (ADR-0055). The backend checks the ceiling again.
 */
export async function savePermissions(principalId: string, scope: "college" | "platform", permissions: string[]): Promise<ActionState> {
  const staff = await requireStaff();
  const tenantId = collegeFor(staff);
  if (!staff.canManageAccounts) return { error: "Only administrators change permissions." };
  if (scope === "platform" && !staff.isPlatformAdmin) return { error: "Only a root administrator grants platform-wide permissions." };
  const path = scope === "platform" ? `/user/v1/staff/${principalId}/permissions` : `/user/v1/tenants/${tenantId}/staff/${principalId}/permissions`;
  try {
    await gateway(path, { method: "PUT", body: { permissions } });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/permissions");
  return { error: null, message: "Permissions saved. They apply from the person's next request." };
}
