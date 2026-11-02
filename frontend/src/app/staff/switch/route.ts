import { redirectTo } from "@/lib/redirect";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { secureCookies } from "@/lib/server/config";
import { ALL_COLLEGES, TENANT_COOKIE, requireStaff } from "@/lib/server/staff";

/**
 * Opens a page that belongs to one college from a list that spans them all. A root
 * administrator's lists show every college together; each row's link comes through
 * here, which points the console at that row's college and sends them on.
 */
export async function GET(request: NextRequest) {
  const staff = await requireStaff();
  const college = request.nextUrl.searchParams.get("college") ?? "";
  const next = request.nextUrl.searchParams.get("next") ?? "/staff";
  // Only a path inside the staff console, never another site.
  const target = next.startsWith("/staff") && !next.startsWith("//") ? next : "/staff";
  if (staff.isPlatformAdmin && (college === ALL_COLLEGES || staff.tenants.some((tenant) => tenant.id === college))) {
    (await cookies()).set({ name: TENANT_COOKIE, value: college, httpOnly: true, secure: secureCookies(), sameSite: "strict", path: "/" });
  }
  return redirectTo(target, 303);
}
