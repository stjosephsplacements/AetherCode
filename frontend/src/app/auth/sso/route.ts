import { type NextRequest, NextResponse } from "next/server";
import { gateway } from "@/lib/server/gateway";
import { safeNext } from "@/lib/viewer";
import { flowCookie } from "./flow";

type Start = { authorization_url: string; state: string; code_verifier: string };

/** Sends the browser to the college's sign-in page (ADR-0042). */
export async function GET(request: NextRequest) {
  let start: Start;
  try {
    start = await gateway<Start>("/identity/v1/auth/sso/start", { method: "POST", anonymous: true });
  } catch {
    return NextResponse.redirect(new URL("/login?sso=unavailable", request.url));
  }
  const next = safeNext(request.nextUrl.searchParams.get("next") ?? "") ?? "";
  const response = NextResponse.redirect(start.authorization_url);
  response.cookies.set(flowCookie({ state: start.state, verifier: start.code_verifier, next }));
  return response;
}
