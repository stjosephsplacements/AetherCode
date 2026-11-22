"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionState } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { collegeFor, requireStaff } from "@/lib/server/staff";

export async function issueTalentCard(_previous: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireStaff();
  const tenantId = collegeFor(staff);
  const studentId = String(form.get("student_id") ?? "");
  const displayName = String(form.get("display_name") ?? "").trim();
  const college = String(form.get("college") ?? "").trim();
  const department = String(form.get("department") ?? "").trim();
  const rollNumber = String(form.get("roll_number") ?? "").trim();
  try {
    const issued = await gateway<{ id: string; token: string; expires_at: string }>(
      `/analytics/v1/tenants/${tenantId}/students/${studentId}/talent-cards`,
      {
        method: "POST",
        body: {
          display_name: displayName || undefined,
          college: college || undefined,
          department: department || undefined,
          roll_number: rollNumber || undefined,
        },
      },
    );
    revalidatePath(`/staff/students/${studentId}`);
    return {
      error: null,
      message: `Issued. Verify at /talent/${issued.token} (expires ${new Date(issued.expires_at).toLocaleDateString()}).`,
    };
  } catch (error) {
    return { error: actionError(error) };
  }
}
