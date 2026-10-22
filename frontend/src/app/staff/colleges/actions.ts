"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import { actionError } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { requireStaff } from "@/lib/server/staff";

export async function createCollege(_previous: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireStaff();
  if (!staff.isPlatformAdmin) return { error: "Only platform administrators add colleges." };
  const text = (name: string) => String(form.get(name) ?? "").trim();
  try {
    await gateway("/tenant/v1/tenants", {
      method: "POST",
      body: { slug: text("slug").toLowerCase(), legal_name: text("legal_name"), display_name: text("display_name") },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/colleges");
  return { error: null, message: "College added. Switch to it above, then create its departments, batches and administrators." };
}
