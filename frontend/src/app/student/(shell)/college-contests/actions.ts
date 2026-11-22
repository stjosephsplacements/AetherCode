"use server";

import { revalidatePath } from "next/cache";
import { gateway } from "@/lib/server/gateway";

export async function registerContest(tenantId: string, contestId: string) {
  await gateway(`/question-bank/v1/tenants/${tenantId}/contests/${contestId}/register`, { method: "POST" });
  revalidatePath("/student/college-contests");
}