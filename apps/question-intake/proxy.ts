import { type NextRequest, NextResponse } from "next/server";

const ACCESS = "qi_access";
const REFRESH = "qi_refresh";

function expiry(token: string | undefined): number {
  try {
    return ((JSON.parse(atob((token ?? "").split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number }).exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

// One refresh per refresh token: identity revokes a session whose refresh token is used twice, and a page
// can fire several requests at once. Concurrent requests share the rotation.
const rotations = new Map<string, Promise<Record<string, string> | null>>();

async function rotate(refresh: string): Promise<Record<string, string> | null> {
  const existing = rotations.get(refresh);
  if (existing) return existing;
  const promise = fetch(`${process.env.GATEWAY_URL}/identity/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ refresh_token: refresh }),
    cache: "no-store",
  })
    .then(async (response) => (response.ok ? ((await response.json()) as Record<string, string>) : null))
    .catch(() => null)
    .finally(() => setTimeout(() => rotations.delete(refresh), 30_000));
  rotations.set(refresh, promise);
  return promise;
}

/** Every request passes here first, so this is the one place a session's tokens rotate. */
export async function proxy(request: NextRequest) {
  const access = request.cookies.get(ACCESS)?.value;
  const refresh = request.cookies.get(REFRESH)?.value;
  if (refresh && expiry(access) - Date.now() < 60_000) {
    const pair = await rotate(refresh);
    if (!pair?.access_token) {
      const response = NextResponse.redirect(new URL("/login?expired=1", request.url));
      for (const name of [ACCESS, REFRESH, "qi_viewer"]) response.cookies.delete(name);
      return response;
    }
    request.cookies.set(ACCESS, pair.access_token!);
    request.cookies.set(REFRESH, pair.refresh_token!);
    const headers = new Headers(request.headers);
    headers.set("cookie", request.cookies.toString());
    const response = NextResponse.next({ request: { headers } });
    const secure = process.env.SECURE_COOKIES === "true";
    const base = { httpOnly: true, secure, sameSite: "strict" as const, path: "/" };
    response.cookies.set({ ...base, name: ACCESS, value: pair.access_token!, expires: new Date(pair.access_token_expires_at!) });
    response.cookies.set({ ...base, name: REFRESH, value: pair.refresh_token!, expires: new Date(pair.refresh_token_expires_at!) });
    return response;
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|fonts/|favicon.ico).*)"] };
