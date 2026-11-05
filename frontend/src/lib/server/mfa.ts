"use server";

import { cookies, headers } from "next/headers";
import type { TokenPair } from "./tokens";
import { ACCESS_COOKIE, accessExpiry } from "./tokens";
import { secureCookies } from "./config";
import { gatewayURL } from "./config";
import { clientIP } from "./request";

/**
 * Verifies a TOTP code against the current session and stamps the access token
 * with MFAVerifiedAt. Returns null on success, or an error string.
 */
export async function performMFAStepUp(code: string): Promise<string | null> {
  const jar = await cookies();
  const access = jar.get(ACCESS_COOKIE)?.value;
  if (!access) return "Your session has ended. Sign in again.";

  const ip = clientIP(await headers());
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${access}`,
  };
  if (ip) requestHeaders["X-Forwarded-For"] = ip;

  const response = await fetch(`${gatewayURL()}/api/identity/v1/auth/mfa/step-up`, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({ code }),
    cache: "no-store",
  });

  if (response.status === 401) return "Your session has ended. Sign in again.";
  if (response.status === 403) return "No MFA factor is enrolled. Contact an administrator.";
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    return body?.message ?? "Verification failed. Try again.";
  }

  const pair = (await response.json()) as TokenPair;
  jar.set({
    name: ACCESS_COOKIE,
    value: pair.access_token,
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "strict",
    path: "/",
    expires: new Date(accessExpiry(pair.access_token)),
  });
  return null;
}
