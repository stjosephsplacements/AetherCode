"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import { actionError } from "@/lib/server/actions";
import { communityRequest } from "@/lib/server/community";
import { requireViewer } from "@/lib/server/session";
import { collegeTimeToISO } from "@/lib/utils";

async function member() {
  const viewer = await requireViewer();
  if (!viewer.tenantId) throw new Error("This account has no college.");
  return viewer.tenantId;
}

function failure(error: unknown): ActionState {
  return { error: error instanceof Error && !("status" in error) ? error.message : actionError(error) };
}

/** Rounds arrive as round_title_0, round_description_0, round_title_1 and so on; empty titles are skipped. */
export async function shareExperience(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const tenantId = await member();
    const rounds: { title: string; description: string }[] = [];
    for (let index = 0; form.has(`round_title_${index}`); index++) {
      const title = String(form.get(`round_title_${index}`) ?? "").trim();
      if (title) rounds.push({ title, description: String(form.get(`round_description_${index}`) ?? "").trim() });
    }
    const year = String(form.get("year_of_interview") ?? "").trim();
    await communityRequest(tenantId, "interview-experiences", "POST", {
      company: String(form.get("company") ?? ""),
      role: String(form.get("role") ?? ""),
      experience_level: String(form.get("experience_level") ?? "fresher"),
      drive_type: String(form.get("drive_type") ?? "on-campus"),
      verdict: String(form.get("verdict") ?? "selected"),
      package_offered: String(form.get("package_offered") ?? ""),
      year_of_interview: year ? Number(year) : null,
      preparation_resources: String(form.get("preparation_resources") ?? ""),
      tips: String(form.get("tips") ?? ""),
      rounds,
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/student/interviews");
  return { error: null, message: "Thank you. Your experience is with the placement team for approval, then everyone in your college can read it." };
}

export async function deleteExperience(form: FormData): Promise<void> {
  const tenantId = await member();
  await communityRequest(tenantId, `interview-experiences/${String(form.get("id"))}`, "DELETE");
  revalidatePath("/student/interviews");
}

export async function setBookmark(form: FormData): Promise<void> {
  const tenantId = await member();
  await communityRequest(tenantId, `feed/${String(form.get("id"))}/bookmark`, "PUT", { on: form.get("on") === "true" });
  revalidatePath("/student", "layout");
}

export async function saveProfileLink(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const tenantId = await member();
    await communityRequest(tenantId, `profile-links/${String(form.get("platform"))}`, "PUT", { handle: String(form.get("handle") ?? "").trim() });
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/student/profile");
  return { error: null, message: "Saved." };
}

export async function addTask(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const tenantId = await member();
    const due = String(form.get("due_date") ?? "");
    await communityRequest(tenantId, "tasks", "POST", { title: String(form.get("title") ?? ""), due_at: due ? collegeTimeToISO(`${due}T23:59`) : null });
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/student/tasks");
  return { error: null, message: null };
}

export async function toggleTask(form: FormData): Promise<void> {
  const tenantId = await member();
  await communityRequest(tenantId, `tasks/${String(form.get("id"))}`, "PATCH", { done: form.get("done") === "true" });
  revalidatePath("/student/tasks");
}

export async function deleteTask(form: FormData): Promise<void> {
  const tenantId = await member();
  await communityRequest(tenantId, `tasks/${String(form.get("id"))}`, "DELETE");
  revalidatePath("/student/tasks");
}
