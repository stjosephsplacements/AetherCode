import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { type Viewer, loadViewer } from "./session.ts";

const ACCESS = "qi_access";

/** Staff bearer from the platform BFF, or the intake session cookie. */
export async function authorizeStaff(request: Request): Promise<{ viewer: Viewer; token: string } | NextResponse> {
  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const cookie = bearer ? "" : (await cookies()).get(ACCESS)?.value ?? "";
  const token = bearer || cookie;
  if (!token) return NextResponse.json({ code: "unauthenticated", message: "Sign in required." }, { status: 401 });
  const viewer = await loadViewer(token);
  if (!viewer) return NextResponse.json({ code: "forbidden", message: "Staff only." }, { status: 403 });
  return { viewer, token };
}