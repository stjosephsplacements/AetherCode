import "server-only";
import { createHash } from "node:crypto";
import { gatewayURL, secureCookies } from "./config";

export const ACCESS_COOKIE = "ac_access";
export const REFRESH_COOKIE = "ac_refresh";
export const VIEWER_COOKIE = "ac_viewer";
/** Set while a staff-issued password must be replaced (ADR-0036). */
export const PASSWORD_COOKIE = "ac_must_change";

/** Refresh this long before the access token expires, so no request carries a stale one. */
const REFRESH_LEEWAY_MS = 60_000;
/**
 * How long a rotation result is reused for the refresh token it consumed.
 * Identity revokes the whole session when a refresh token is presented twice,
 * and the exam screen fires several requests at once (autosave, run polling).
 * Requests that still carry the old cookie get the same new pair instead.
 */
const ROTATION_REUSE_MS = 30_000;

export type TokenPair = {
  access_token: string;
  access_token_expires_at: string;
  refresh_token: string;
  refresh_token_expires_at: string;
  password_change_required?: boolean;
};

export type CookieSpec = {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "strict";
  path: "/";
  expires: Date;
};

/** The expiry of a JWT in milliseconds, read without verification (the gateway verifies). */
export function accessExpiry(token: string): number {
  try {
    const payload = token.split(".")[1];
    if (!payload) return 0;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
    return typeof claims.exp === "number" ? claims.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export function accessSubject(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string };
    return claims.sub ?? null;
  } catch {
    return null;
  }
}

export function needsRefresh(accessToken: string | undefined, now = Date.now()): boolean {
  return !accessToken || accessExpiry(accessToken) - REFRESH_LEEWAY_MS <= now;
}

export function sessionCookies(pair: TokenPair): CookieSpec[] {
  const base = { httpOnly: true, secure: secureCookies(), sameSite: "strict", path: "/" } as const;
  return [
    { ...base, name: ACCESS_COOKIE, value: pair.access_token, expires: new Date(pair.access_token_expires_at) },
    { ...base, name: REFRESH_COOKIE, value: pair.refresh_token, expires: new Date(pair.refresh_token_expires_at) },
  ];
}

type Rotation = { promise: Promise<TokenPair | null>; settledAt: number | null };
const rotations = new Map<string, Rotation>();

/**
 * Rotates a refresh token once per process, however many requests ask at the
 * same time. Returns null when Identity refuses the token (the session is over).
 */
export function rotateRefreshToken(refreshToken: string, clientIP: string | null): Promise<TokenPair | null> {
  const key = createHash("sha256").update(refreshToken).digest("hex");
  const now = Date.now();
  for (const [hash, rotation] of rotations) {
    if (rotation.settledAt !== null && now - rotation.settledAt > ROTATION_REUSE_MS) rotations.delete(hash);
  }
  const existing = rotations.get(key);
  if (existing) return existing.promise;

  const rotation: Rotation = { promise: Promise.resolve(null), settledAt: null };
  rotation.promise = postRefresh(refreshToken, clientIP).finally(() => {
    rotation.settledAt = Date.now();
  });
  rotations.set(key, rotation);
  return rotation.promise;
}

async function postRefresh(refreshToken: string, clientIP: string | null): Promise<TokenPair | null> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (clientIP) headers["X-Forwarded-For"] = clientIP;
  const response = await fetch(`${gatewayURL()}/api/identity/v1/auth/refresh`, {
    method: "POST",
    headers,
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: "no-store",
  });
  if (response.status === 400 || response.status === 401) return null;
  if (!response.ok) throw new Error(`token refresh failed: HTTP ${response.status}`);
  return (await response.json()) as TokenPair;
}
