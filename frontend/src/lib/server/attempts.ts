import "server-only";
import type { Attempt } from "@/lib/api-types";
import { fetchAllPages } from "./fetch-all";

/** Every attempt of the signed-in student, following the cursor. */
export function listMyAttempts(tenantId: string): Promise<Attempt[]> {
  return fetchAllPages<Attempt>(`/submission/v1/tenants/${tenantId}/attempts`);
}
