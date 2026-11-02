import { NextResponse } from "next/server";

/**
 * A redirect to a path on this site from a route handler. The Location is relative, so
 * the browser follows it on whatever address it used. Building an absolute URL from the
 * request instead breaks when the server is bound to 0.0.0.0, which then reports itself
 * as the host.
 */
export function redirectTo(path: string, status: 307 | 303 = 307): NextResponse {
  return new NextResponse(null, { status, headers: { Location: path } });
}

/**
 * The origin people load the site from. PUBLIC_ORIGIN is that by definition; without it
 * the Host header the browser sent is the next best thing. Never request.url, which is
 * the address the server bound to.
 */
export function siteOrigin(request: { headers: Headers; url: string }): string {
  const configured = process.env.PUBLIC_ORIGIN?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return new URL(request.url).origin;
  const protocol = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return `${protocol}://${host}`;
}

/** A redirect to a path on this site from the proxy, which needs an absolute Location. */
export function siteRedirect(request: { headers: Headers; url: string }, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, siteOrigin(request)));
}
