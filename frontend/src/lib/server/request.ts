import "server-only";
import { clientAddress } from "@/lib/client-ip";

/**
 * The student's address from X-Forwarded-For, behind Cloudflare and Traefik. Those append to a header the visitor may
 * have written, so the address is the rightmost one that is not an internal hop, not the first entry; the gateway then
 * trusts the single value this sends, but only from this server's network.
 */
export function clientIP(headers: Headers): string | null {
  return clientAddress(headers.get("x-forwarded-for"));
}
