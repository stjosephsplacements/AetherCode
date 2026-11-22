"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import { actionError } from "@/lib/server/actions";
import { communityRequest } from "@/lib/server/community";
import { requirePlacement } from "@/lib/server/placement";
import { collegeTimeToISO } from "@/lib/utils";

const MODERATION = "moderation";

function failure(error: unknown): ActionState {
  return { error: error instanceof Error && !("status" in error) ? error.message : actionError(error) };
}

const tags = (form: FormData) =>
  String(form.get("tags") ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

async function collegeOf(form: FormData): Promise<string> {
  const placement = await requirePlacement();
  const collegeId = String(form.get("college_id") ?? "").trim();
  if (!placement.colleges.some((college) => college.id === collegeId)) {
    throw new Error("That college is outside your reach.");
  }
  return collegeId;
}

export async function savePlacementPost(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const tenantId = await collegeOf(form);
    const id = String(form.get("id") ?? "");
    await communityRequest(tenantId, `${MODERATION}/posts`, "PUT", {
      ...(id ? { id } : {}),
      title: String(form.get("title") ?? ""),
      body_markdown: String(form.get("body_markdown") ?? ""),
      tags: tags(form),
      status: form.get("publish") === "on" ? "published" : "draft",
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/placement/community");
  return { error: null, message: "Saved." };
}

export async function removePlacementPost(collegeId: string, id: string): Promise<ActionState> {
  const placement = await requirePlacement();
  if (!placement.colleges.some((college) => college.id === collegeId)) {
    return { error: "That college is outside your reach." };
  }
  try {
    await communityRequest(collegeId, `${MODERATION}/posts/${id}`, "DELETE");
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/placement/community");
  return { error: null, message: "Deleted." };
}

export async function savePlacementListing(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const tenantId = await collegeOf(form);
    const id = String(form.get("id") ?? "");
    const at = (name: string) => {
      const value = String(form.get(name) ?? "");
      return value ? collegeTimeToISO(value) : null;
    };
    await communityRequest(tenantId, `${MODERATION}/feed`, "PUT", {
      ...(id ? { id } : {}),
      kind: String(form.get("kind") ?? ""),
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      url: String(form.get("url") ?? ""),
      platform: String(form.get("platform") ?? ""),
      starts_at: at("starts_at"),
      ends_at: at("ends_at"),
      tags: tags(form),
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/placement/community");
  return { error: null, message: "Saved." };
}
