import { NextResponse, type NextRequest } from "next/server";
import { clientIP } from "@/lib/server/request";
import {
  ACCESS_COOKIE,
  PASSWORD_COOKIE,
  REFRESH_COOKIE,
  VIEWER_COOKIE,
  needsRefresh,
  rotateRefreshToken,
  sessionCookies,
} from "@/lib/server/tokens";

// Every page and /api request passes through here first, so this is the one
// place a session's tokens are rotated. Pages and route handlers downstream
// only read the access cookie.
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Single sign-on pages run before there is a session (ADR-0042).
  const isLogin = pathname === "/login" || pathname.startsWith("/auth/sso") || pathname.startsWith("/loader-preview");
  const isAPI = pathname.startsWith("/api/");
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;

  if (refresh && needsRefresh(access)) {
    let pair;
    try {
      pair = await rotateRefreshToken(refresh, clientIP(request.headers));
    } catch {
      // The gateway is unreachable: let the request through; it will fail
      // on its own and the session is kept for when the gateway is back.
      return NextResponse.next();
    }
    if (pair === null) return endSession(request, isLogin || isAPI);

    request.cookies.set(ACCESS_COOKIE, pair.access_token);
    request.cookies.set(REFRESH_COOKIE, pair.refresh_token);
    const headers = new Headers(request.headers);
    headers.set("cookie", request.cookies.toString());
    const response = NextResponse.next({ request: { headers } });
    for (const cookie of sessionCookies(pair)) response.cookies.set(cookie);
    return response;
  }

  // A staff-issued password is replaced before anything else (ADR-0036).
  if (request.cookies.get(PASSWORD_COOKIE) && !isAPI && !isLogin && pathname !== "/account/password") {
    return NextResponse.redirect(new URL("/account/password", request.url));
  }

  if (!access && !refresh && !isLogin && !isAPI) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

function endSession(request: NextRequest, passThrough: boolean) {
  const response = passThrough
    ? NextResponse.next()
    : NextResponse.redirect(new URL("/login", request.url));
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, VIEWER_COOKIE, PASSWORD_COOKIE]) response.cookies.delete(name);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|monaco/|vendor/|3\\.png|4\\.png|logo\\.png|logo-light\\.png|logo-dark\\.png|favicon\\.ico|robots\\.txt).*)"],
};
