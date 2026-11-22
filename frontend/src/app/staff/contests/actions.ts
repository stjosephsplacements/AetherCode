"use server";

import { revalidatePath } from "next/cache";
import { gateway } from "@/lib/server/gateway";

export async function createContest(collegeId: string, formData: FormData) {
  const questionIds = String(formData.get("question_ids") ?? "")
    .split(/[\s,]+/)
    .filter(Boolean);
  await gateway(`/question-bank/v1/tenants/${collegeId}/contests`, {
    method: "POST",
    body: JSON.stringify({
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      starts_at: new Date(String(formData.get("starts_at"))).toISOString(),
      ends_at: new Date(String(formData.get("ends_at"))).toISOString(),
      question_ids: questionIds,
    }),
  });
  revalidatePath("/staff/contests");
}