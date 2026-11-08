"use server";

import { redirect } from "next/navigation";
import { GatewayError, gateway } from "@/lib/server/gateway";
import { clearSession, fetchViewer, storeViewer } from "@/lib/server/session";
import { secureCookies } from "@/lib/server/config";
import { PASSWORD_COOKIE, REFRESH_COOKIE, type TokenPair, sessionCookies } from "@/lib/server/tokens";
import { cookies } from "next/headers";
import { TENANT_COOKIE } from "@/lib/server/staff";
import { homeFor, safeNext } from "@/lib/viewer";

export type LoginState = { error: string | null; identifier: string; challenge?: string };
export type VerifyState = { error: string | null; expired?: boolean };

export async function login(_previous: LoginState, form: FormData): Promise<LoginState> {
  const identifier = String(form.get("identifier") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!identifier || !password) return { error: "Enter your username or roll number and your password.", identifier };

  let pair: TokenPair;
  try {
    pair = await gateway<TokenPair>("/identity/v1/auth/login", {
      method: "POST",
      body: { identifier, password },
      anonymous: true,
    });
  } catch (error) {
    if (error instanceof GatewayError && error.status === 401) {
      return { error: "That username or password is wrong.", identifier };
    }
    if (error instanceof GatewayError && error.status === 429) {
      return { error: "Too many sign-in attempts. Wait a minute and try again.", identifier };
    }
    return { error: "The exam server could not sign you in. Try again in a moment.", identifier };
  }
  if (pair.mfa_required && pair.mfa_challenge_token) return { error: null, identifier, challenge: pair.mfa_challenge_token };
  if (!pair.access_token) return { error: "The exam server could not sign you in. Try again in a moment.", identifier };
  return finishSignIn(pair, String(form.get("next") ?? ""), identifier);
}

/** Second step of a sign-in for an account with an authenticator app (or a recovery code). */
export async function verifyLogin(_previous: VerifyState, form: FormData): Promise<VerifyState> {
  const challenge = String(form.get("mfa_challenge_token") ?? "");
  const code = String(form.get("code") ?? "").replace(/\s+/g, "");
  if (!challenge) return { error: "Sign in again.", expired: true };
  if (!code) return { error: "Enter the code from your authenticator app." };

  let pair: TokenPair;
  try {
    pair = await gateway<TokenPair>("/identity/v1/auth/mfa/verify-login", {
      method: "POST",
      body: { mfa_challenge_token: challenge, code },
      anonymous: true,
    });
  } catch (error) {
    if (error instanceof GatewayError && error.status === 401) {
      return { error: "That code is wrong or has expired. Check the code and try again." };
    }
    if (error instanceof GatewayError && error.status === 429) {
      return { error: "Too many attempts. Wait a minute and try again." };
    }
    if (error instanceof GatewayError && (error.status === 400 || error.status === 404 || error.status === 410)) {
      return { error: "This sign-in expired. Start again.", expired: true };
    }
    return { error: "The exam server could not verify the code. Try again in a moment." };
  }
  const failed = await finishSignIn(pair, String(form.get("next") ?? ""), "");
  return { error: failed.error };
}

/**
 * Stores the session cookies and sends the user to their home. It returns only when something
 * went wrong, with the message to show.
 */
async function finishSignIn(pair: TokenPair, rawNext: string, identifier: string): Promise<LoginState> {
  const jar = await cookies();
  for (const cookie of sessionCookies(pair)) jar.set(cookie);
  let viewer;
  try {
    viewer = await fetchViewer(pair.access_token);
  } catch {
    await clearSession();
    return { error: "Signed in, but your account details could not be loaded. Try again in a moment.", identifier };
  }
  await storeViewer(viewer, new Date(pair.refresh_token_expires_at));
  // Each sign-in starts in the admin console, not in the college last opened.
  if (viewer.roles.includes("super_admin")) jar.delete(TENANT_COOKIE);
  const next = safeNext(rawNext) ?? homeFor(viewer);
  if (pair.password_change_required) {
    // A password staff issued must be replaced before anything else (ADR-0036).
    jar.set({ name: PASSWORD_COOKIE, value: "1", httpOnly: true, secure: secureCookies(), sameSite: "strict", path: "/", expires: new Date(pair.refresh_token_expires_at) });
    redirect(`/account/password?next=${encodeURIComponent(next)}`);
  }
  redirect(next);
}

export async function logout() {
  const refresh = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (refresh) {
    // Revoke the session server-side too; the cookies are cleared regardless.
    await gateway("/identity/v1/auth/logout", { method: "POST", body: { refresh_token: refresh }, anonymous: true }).catch(() => {});
  }
  await clearSession();
  redirect("/login");
}
