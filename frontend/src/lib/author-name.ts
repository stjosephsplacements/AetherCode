import type { AccountSummary } from "@/lib/api-types";

/** Display name for a content author, or an em dash when unknown (ADR-0090). */
export function authorName(names: Map<string, AccountSummary> | Record<string, string>, principalId: string | null | undefined): string {
  if (!principalId) return "—";
  if (names instanceof Map) return names.get(principalId)?.display_name ?? "—";
  return names[principalId] ?? "—";
}
