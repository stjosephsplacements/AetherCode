const INTERNAL = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^::1$/, /^f[cd][0-9a-f]{2}:/i, /^fe80:/i];

/**
 * The visitor's address from an X-Forwarded-For chain: the rightmost entry that is not one of our own internal hops.
 * A visitor can write anything at the left of the chain, and Cloudflare appends to it instead of replacing it, so the
 * leftmost entry would let a student outside the lab claim a lab address (ADR-0030). When every hop is internal (an
 * in-cluster caller) the leftmost entry is used.
 */
export function clientAddress(chain: string | null): string | null {
  const hops = (chain ?? "").split(",").map((hop) => hop.trim()).filter(Boolean);
  for (let index = hops.length - 1; index >= 0; index--) {
    if (!INTERNAL.some((pattern) => pattern.test(hops[index]!))) return hops[index]!;
  }
  return hops[0] ?? null;
}
