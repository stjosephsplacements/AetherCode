import { headers } from "next/headers";
import { normalizeClientIp } from "./net.ts";

// Only trustworthy behind deploy/nginx.conf, which overwrites X-Forwarded-For
// with the real connection address so clients cannot spoof it.
export async function clientIp(): Promise<string | null> {
  return normalizeClientIp((await headers()).get("x-forwarded-for"));
}
