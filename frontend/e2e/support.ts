// Shared by the browser specs: the platform administrator's credentials, authenticator codes and
// an MFA-verified API session. Elevated writes (accounts, roles, grants) need MFA in the last
// 15 minutes, so the administrator holds a TOTP factor; its secret is the third word of E2E_ADMIN_FILE.
import { expect, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

// Keep test credentials on the local platform; never let an environment
// override redirect authentication requests to an external gateway.
export const GATEWAY = "http://127.0.0.1:8380/api";

const words = readFileSync(process.env.E2E_ADMIN_FILE ?? `${homedir()}/aethercode-admin.txt`, "utf8").trim().split(/\s+/);
export const adminEmail = words[0]!;
export const adminPassword = words[1]!;
export const adminTotpSecret = words[2];

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.replace(/=+$/, "").toUpperCase()) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 code (SHA-1, 6 digits, 30 s) for a given 30-second step. */
export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

const usedSteps = new Map<string, number>();

/** A code that was not used before: Identity rejects a replayed code, so wait for the next window. */
export async function freshTotp(secret: string): Promise<string> {
  let step = Math.floor(Date.now() / 30_000);
  if ((usedSteps.get(secret) ?? 0) >= step) {
    await new Promise((resolve) => setTimeout(resolve, (step + 1) * 30_000 - Date.now() + 500));
    step = Math.floor(Date.now() / 30_000);
  }
  usedSteps.set(secret, step);
  return totpAt(secret, step);
}

export async function call<T>(method: string, path: string, body?: unknown, token?: string, expectStatus = 200): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(GATEWAY + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(method === "GET" ? {} : { "Idempotency-Key": crypto.randomUUID() }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body), // lgtm[js/file-access-to-http]
    });
    if (response.status === 503 && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    const payload = await response.json().catch(() => null);
    if (response.status !== expectStatus) throw new Error(`${method} ${path}: HTTP ${response.status} ${JSON.stringify(payload)}`);
    return payload as T;
  }
}

type Pair = { access_token: string; mfa_required?: boolean; mfa_challenge_token?: string };

/** The administrator's access token, signed in through the MFA challenge and stepped up. */
export async function adminSession(): Promise<string> {
  let pair = await call<Pair>("POST", "/identity/v1/auth/login", { identifier: adminEmail, password: adminPassword });
  if (pair.mfa_required) {
    if (!adminTotpSecret) throw new Error("the administrator needs MFA; add the TOTP secret as the third word of E2E_ADMIN_FILE");
    pair = await call<Pair>("POST", "/identity/v1/auth/mfa/verify-login", { mfa_challenge_token: pair.mfa_challenge_token, code: await freshTotp(adminTotpSecret) });
  }
  if (!adminTotpSecret) return pair.access_token;
  const stepped = await call<Pair>("POST", "/identity/v1/auth/mfa/step-up", { code: await freshTotp(adminTotpSecret) }, pair.access_token);
  return stepped.access_token;
}

/** The "Get started" checklist opens over a college that is still being set up; close it if it shows. */
export async function dismissOnboarding(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Get started" });
  const shown = await dialog.waitFor({ state: "visible", timeout: 8_000 }).then(() => true, () => false);
  if (!shown) return;
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
}
