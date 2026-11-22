import type { AccountSummary } from "@/lib/api-types";

/**
 * POST /user/v1/tenants/{t}/accounts/describe may return a bare array (older
 * handlers) or `{ accounts: [...] }` (OpenAPI). Accept both.
 */
export function asAccountSummaries(body: unknown): AccountSummary[] {
  if (Array.isArray(body)) return body as AccountSummary[];
  if (body && typeof body === "object" && Array.isArray((body as { accounts?: unknown }).accounts)) {
    return (body as { accounts: AccountSummary[] }).accounts;
  }
  return [];
}
