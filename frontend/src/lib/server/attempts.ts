import "server-only";
import type { Attempt, Page } from "@/lib/api-types";
import { gateway } from "./gateway";

/** Every attempt of the signed-in student, following the cursor (up to 5000). */
export async function listMyAttempts(tenantId: string): Promise<Attempt[]> {
  const attempts: Attempt[] = [];
  let cursor = "";
  for (let page = 0; page < 50; page++) {
    const result = await gateway<Page<Attempt>>(`/submission/v1/tenants/${tenantId}/attempts?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    attempts.push(...result.items);
    if (!result.next_cursor) break;
    cursor = result.next_cursor;
  }
  return attempts;
}
