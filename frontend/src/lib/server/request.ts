import "server-only";

/**
 * The student's address as nginx reported it. nginx overwrites
 * X-Forwarded-For with $remote_addr, so its first entry is trustworthy here;
 * the gateway in turn trusts it only from this server's network.
 */
export function clientIP(headers: Headers): string | null {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}
