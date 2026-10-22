import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { GatewayError, gateway } from "@/lib/server/gateway";
import { secureCookies } from "@/lib/server/config";
import { fetchViewer } from "@/lib/server/session";
import { type TokenPair, VIEWER_COOKIE, sessionCookies } from "@/lib/server/tokens";
import { homeFor } from "@/lib/viewer";
import { SSO_FLOW_COOKIE, readFlow } from "../flow";

function sameState(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The provider sends the browser back here with a code (ADR-0042). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const fail = (reason: string) => {
    const response = NextResponse.redirect(new URL(`/login?sso=${reason}`, request.url));
    response.cookies.delete({ name: SSO_FLOW_COOKIE, path: "/auth/sso" });
    return response;
  };
  const flow = readFlow(request.cookies.get(SSO_FLOW_COOKIE)?.value);
  const code = params.get("code");
  const state = params.get("state");
  if (params.get("error")) return fail("cancelled");
  if (!flow || !code || !state || !sameState(state, flow.state)) return fail("expired");

  let pair: TokenPair;
  try {
    pair = await gateway<TokenPair>("/identity/v1/auth/sso/callback", {
      method: "POST",
      body: { code, code_verifier: flow.verifier },
      anonymous: true,
    });
  } catch (error) {
    if (error instanceof GatewayError && error.status === 403) return fail("no_account");
    if (error instanceof GatewayError && error.status === 429) return fail("busy");
    return fail("failed");
  }

  let viewer;
  try {
    viewer = await fetchViewer(pair.access_token);
  } catch {
    return fail("failed");
  }
  const response = NextResponse.redirect(new URL(flow.next || homeFor(viewer), request.url));
  for (const cookie of sessionCookies(pair)) response.cookies.set(cookie);
  response.cookies.delete({ name: SSO_FLOW_COOKIE, path: "/auth/sso" });
  // Set on the redirect itself, like the viewer cookie storeViewer writes.
  response.cookies.set({
    name: VIEWER_COOKIE, value: JSON.stringify(viewer), httpOnly: true, secure: secureCookies(),
    sameSite: "strict", path: "/", expires: new Date(pair.refresh_token_expires_at),
  });
  return response;
}
