"use server";

import { revalidatePath } from "next/cache";
import { gateway } from "@/lib/server/gateway";
import { requireStaff } from "@/lib/server/staff";

export async function syncCollegePlatformProfiles(collegeId: string) {
  const staff = await requireStaff();
  await gateway(`/user/v1/tenants/${collegeId}/platform-profiles/sync`, { method: "POST" });
  revalidatePath("/staff/analytics");
}