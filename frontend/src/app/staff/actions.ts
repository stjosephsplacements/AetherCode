"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { secureCookies } from "@/lib/server/config";
import { TENANT_COOKIE } from "@/lib/server/staff";

/** A platform administrator picks the college they work in. */
export async function chooseTenant(form: FormData) {
  const tenantId = String(form.get("tenant_id") ?? "");
  (await cookies()).set({ name: TENANT_COOKIE, value: tenantId, httpOnly: true, secure: secureCookies(), sameSite: "strict", path: "/" });
  revalidatePath("/staff", "layout");
}
