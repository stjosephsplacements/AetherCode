"use server";

import { GatewayError, gateway } from "@/lib/server/gateway";
import { requireViewer } from "@/lib/server/session";

export type EnrollState = {
  error: string | null;
  /** Set once an authenticator factor is pending: the seed to add to the app and the factor to activate. */
  factorId?: string;
  secret?: string;
  otpauthUri?: string;
  /** Shown once, after activation. */
  recoveryCodes?: string[];
};

/** Starts adding an authenticator app: Identity returns a one-time seed. */
export async function beginTOTP(_previous: EnrollState, form: FormData): Promise<EnrollState> {
  await requireViewer();
  const label = String(form.get("label") ?? "").trim() || "Authenticator";
  try {
    const factor = await gateway<{ factor_id: string; secret: string; otpauth_uri: string }>("/identity/v1/auth/mfa/totp", {
      method: "POST",
      body: { label },
    });
    return { error: null, factorId: factor.factor_id, secret: factor.secret, otpauthUri: factor.otpauth_uri };
  } catch (error) {
    return { error: error instanceof GatewayError ? error.message : "The authenticator could not be started. Try again." };
  }
}

/** Activates the pending factor with a code from the app and returns the recovery codes once. */
export async function activateTOTP(previous: EnrollState, form: FormData): Promise<EnrollState> {
  await requireViewer();
  const factorId = String(form.get("factor_id") ?? "");
  const code = String(form.get("code") ?? "").replace(/\s+/g, "");
  if (!factorId) return { error: "Start again." };
  if (!/^[0-9]{6}$/.test(code)) return { ...previous, error: "Enter the 6-digit code from your authenticator app." };
  try {
    const result = await gateway<{ recovery_codes: string[] }>(`/identity/v1/auth/mfa/totp/${encodeURIComponent(factorId)}/activate`, {
      method: "POST",
      body: { code },
    });
    return { error: null, recoveryCodes: result.recovery_codes };
  } catch (error) {
    if (error instanceof GatewayError && (error.status === 400 || error.status === 401)) {
      return { ...previous, error: "That code is wrong or has expired. Try the next code." };
    }
    return { ...previous, error: error instanceof GatewayError ? error.message : "The code could not be checked. Try again." };
  }
}
