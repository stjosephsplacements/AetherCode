import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { redirectTo } from "@/lib/redirect";
import { secureCookies } from "@/lib/server/config";
import { TENANT_COOKIE, requireAdmin } from "@/lib/server/staff";

/**
 * Opens one college's workspace from the admin console. /staff is college-specific: a platform
 * administrator works in a college only after choosing it here, and leaves with "Back to admin".
 */
export async function GET(request: NextRequest) {
  const staff = await requireAdmin();
  const college = request.nextUrl.searchParams.get("college") ?? "";
  const next = request.nextUrl.searchParams.get("next") ?? "/staff";
  // Only a path inside the staff workspace, never another site.
  const target = next.startsWith("/staff") && !next.startsWith("//") ? next : "/staff";
  if (!staff.tenants.some((tenant) => tenant.id === college)) return redirectTo("/admin/colleges", 303);
  (await cookies()).set({ name: TENANT_COOKIE, value: college, httpOnly: true, secure: secureCookies(), sameSite: "strict", path: "/" });
  return redirectTo(target, 303);
}
