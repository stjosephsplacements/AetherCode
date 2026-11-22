import type { AuditEntry } from "@/lib/api-types";

/**
 * GET …/staff-audit may return a bare array (handler/DB) or `{ entries: [...] }`
 * (OpenAPI). Accept both.
 */
export function asAuditEntries(body: unknown): AuditEntry[] {
  if (Array.isArray(body)) return body as AuditEntry[];
  if (body && typeof body === "object" && Array.isArray((body as { entries?: unknown }).entries)) {
    return (body as { entries: AuditEntry[] }).entries;
  }
  return [];
}
