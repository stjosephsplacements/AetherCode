import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { redirectTo } from "@/lib/redirect";
import { secureCookies } from "@/lib/server/config";
import { TENANT_COOKIE, requireAdmin } from "@/lib/server/staff";

/**
 * Opens a college context from the admin console (Explore or Colleges). Sets the working-college
 * cookie, then sends the administrator into /staff or /placement. They leave with "Back to explore".
 */
export async function GET(request: NextRequest) {
  const staff = await requireAdmin();
  const college = request.nextUrl.searchParams.get("college") ?? "";
  const next = request.nextUrl.searchParams.get("next") ?? "/staff";
  // Only staff or placement paths on this site — never another origin or a relative escape.
  const target = safeAreaPath(next) ?? "/staff";
  if (!staff.tenants.some((tenant) => tenant.id === college)) return redirectTo("/admin/explore", 303);
  (await cookies()).set({ name: TENANT_COOKIE, value: college, httpOnly: true, secure: secureCookies(), sameSite: "strict", path: "/" });
  return redirectTo(target, 303);
}

/** /staff… or /placement… only; rejects protocol-relative and other prefixes. */
function safeAreaPath(next: string): string | null {
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  if (next.startsWith("/staff") || next.startsWith("/placement")) return next;
  return null;
}
