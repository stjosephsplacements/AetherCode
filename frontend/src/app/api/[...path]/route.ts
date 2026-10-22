import type { NextRequest } from "next/server";
import { gatewayURL, publicOrigin } from "@/lib/server/config";
import { clientIP } from "@/lib/server/request";
import { ACCESS_COOKIE } from "@/lib/server/tokens";

// The browser's door to the platform. /api/<service>/... is forwarded to the
// gateway under the same path and query, so the URL Safe Exam Browser hashed
// (public origin + path) is exactly the one the gateway checks. The session's
// bearer is added from its httpOnly cookie; the browser never sees a token.

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "idempotency-key",
  "user-agent",
  "x-safeexambrowser-requesthash",
  "x-safeexambrowser-configkeyhash",
];
const FORWARDED_RESPONSE_HEADERS = ["content-type", "content-disposition", "cache-control", "retry-after"];

async function forward(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);

  // Sign-in, refresh and sign-out run server-side so tokens stay in cookies.
  if (url.pathname.startsWith("/api/identity/v1/auth/")) {
    return problem(404, "not_found", "Not found.");
  }
  // Cookies authenticate these requests, so refuse other sites' forms and scripts.
  if (request.method !== "GET" && request.headers.get("origin") !== publicOrigin()) {
    return problem(403, "forbidden", "Cross-site request refused.");
  }
  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return problem(401, "unauthenticated", "Your session has ended. Sign in again.");

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("authorization", `Bearer ${token}`);
  const ip = clientIP(request.headers);
  if (ip) headers.set("x-forwarded-for", ip);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(gatewayURL() + url.pathname + url.search, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return problem(502, "gateway_unreachable", "The exam server is not reachable. Check your connection and try again.");
  }

  const responseHeaders = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  // Launch files are gzip data served as-is; keep proxies from re-encoding them.
  if (upstream.headers.get("content-encoding") === "identity") responseHeaders.set("content-encoding", "identity");
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

function problem(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
