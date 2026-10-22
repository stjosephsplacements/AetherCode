import { secureCookies } from "@/lib/server/config";

/** The state and PKCE verifier kept for one single sign-on, bound to this browser (ADR-0042). */
export const SSO_FLOW_COOKIE = "ac_sso_flow";

export type SSOFlow = { state: string; verifier: string; next: string };

export function flowCookie(flow: SSOFlow) {
  return {
    name: SSO_FLOW_COOKIE,
    value: Buffer.from(JSON.stringify(flow)).toString("base64url"),
    httpOnly: true,
    secure: secureCookies(),
    // Lax: the provider sends the browser back with a top-level GET.
    sameSite: "lax" as const,
    path: "/auth/sso",
    maxAge: 600,
  };
}

export function readFlow(value: string | undefined): SSOFlow | null {
  if (!value) return null;
  try {
    const flow = JSON.parse(Buffer.from(value, "base64url").toString()) as Partial<SSOFlow>;
    return typeof flow.state === "string" && typeof flow.verifier === "string" ? { state: flow.state, verifier: flow.verifier, next: flow.next ?? "" } : null;
  } catch {
    return null;
  }
}
