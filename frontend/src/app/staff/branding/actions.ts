"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import { gateway, GatewayError } from "@/lib/server/gateway";
import { gatewayURL } from "@/lib/server/config";
import { requireCollege } from "@/lib/server/staff";

type BrandingView = {
  app_name?: string | null;
  accent_color?: string | null;
  logos?: { id: string; url?: string; position: number; alt_text: string }[];
};

export async function saveBranding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  const appName = String(formData.get("app_name") ?? "").trim();
  const accentColor = String(formData.get("accent_color") ?? "").trim();
  try {
    await gateway<BrandingView>(`/tenant/v1/tenants/${tenantId}/branding`, {
      method: "PUT",
      body: {
        app_name: appName,
        accent_color: accentColor || null,
      },
    });
    revalidatePath("/staff/branding");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof GatewayError ? error.message : "Branding could not be saved" };
  }
}

export async function uploadLogo(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a logo file first" };
  }
  if (file.size > 1_048_576) {
    return { error: "Logos must be 1 MB or smaller" };
  }
  const body = new FormData();
  body.set("logo", file);
  body.set("alt_text", String(formData.get("alt_text") ?? "").trim());
  try {
    const response = await fetch(`${gatewayURL()}/api/tenant/v1/tenants/${tenantId}/branding/logos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await bearerToken()}` },
      body,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      return { error: payload?.message ?? `Upload failed (${response.status})` };
    }
    revalidatePath("/staff/branding");
    return { ok: true };
  } catch {
    return { error: "Logo upload failed" };
  }
}

export async function deleteLogo(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  const logoId = String(formData.get("logo_id") ?? "");
  if (!logoId) return { error: "Missing logo" };
  try {
    await gateway<BrandingView>(`/tenant/v1/tenants/${tenantId}/branding/logos/${logoId}`, { method: "DELETE" });
    revalidatePath("/staff/branding");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof GatewayError ? error.message : "Logo could not be removed" };
  }
}

async function bearerToken(): Promise<string> {
  const { cookies } = await import("next/headers");
  const { ACCESS_COOKIE } = await import("@/lib/server/tokens");
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) throw new GatewayError(401, "unauthenticated", "Your session has ended. Sign in again.");
  return token;
}