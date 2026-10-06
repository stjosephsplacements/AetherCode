import { headers } from "next/headers";

/**
 * The origin students reach the app at. APP_URL wins when set; otherwise the
 * Host and X-Forwarded-Proto the reverse proxy passes (plain http without one,
 * because that is what Next serves).
 */
export async function publicOrigin(): Promise<string> {
  if (process.env.APP_URL) return new URL(process.env.APP_URL).origin;
  const hdrs = await headers();
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  return `${proto}://${hdrs.get("host") ?? "localhost"}`;
}
