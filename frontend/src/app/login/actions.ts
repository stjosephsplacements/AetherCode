"use server";

import { redirect } from "next/navigation";
import { GatewayError, gateway } from "@/lib/server/gateway";
import { clearSession, fetchViewer, storeViewer } from "@/lib/server/session";
import { secureCookies } from "@/lib/server/config";
import { PASSWORD_COOKIE, REFRESH_COOKIE, type TokenPair, sessionCookies } from "@/lib/server/tokens";
import { cookies } from "next/headers";
import { homeFor, safeNext } from "@/lib/viewer";

export type LoginState = { error: string | null; identifier: string };

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
  if (!pair.access_token) {
    return { error: "This account needs two-factor sign-in, which this site does not offer yet. Ask an administrator.", identifier };
  }

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
  const next = safeNext(String(form.get("next") ?? "")) ?? homeFor(viewer);
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
