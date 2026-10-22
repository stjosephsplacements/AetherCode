"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import type { FeedKind } from "@/lib/api-types";
import type { ListingDraft } from "@/lib/external";
import { actionError } from "@/lib/server/actions";
import { communityRequest } from "@/lib/server/community";
import { mapLimit } from "@/lib/server/exams";
import { goodFirstIssues, upcomingCodeforcesContests } from "@/lib/server/platforms";
import { requireCollege } from "@/lib/server/staff";
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

export async function reviewExperience(form: FormData): Promise<void> {
  const { tenantId } = await requireCollege();
  await communityRequest(tenantId, `${MODERATION}/interview-experiences/${String(form.get("id"))}/review`, "POST", {
    approve: form.get("approve") === "true",
    note: String(form.get("note") ?? ""),
  });
  revalidatePath("/staff/community");
}

export async function savePost(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { tenantId } = await requireCollege();
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
  revalidatePath("/staff/community");
  return { error: null, message: "Saved." };
}

export async function deletePost(form: FormData): Promise<void> {
  const { tenantId } = await requireCollege();
  await communityRequest(tenantId, `${MODERATION}/posts/${String(form.get("id"))}`, "DELETE");
  revalidatePath("/staff/community");
}

export async function saveListing(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { tenantId } = await requireCollege();
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
  revalidatePath("/staff/community");
  return { error: null, message: "Saved." };
}

export async function deleteListing(form: FormData): Promise<void> {
  const { tenantId } = await requireCollege();
  await communityRequest(tenantId, `${MODERATION}/feed/${String(form.get("id"))}`, "DELETE");
  revalidatePath("/staff/community");
}

async function importListings(listings: ListingDraft[] | null, source: string, kind: FeedKind): Promise<ActionState> {
  if (listings === null) return { error: `${source} did not answer. Try again in a few minutes.` };
  if (listings.length === 0) return { error: null, message: `${source} has nothing new to list.` };
  try {
    const { tenantId } = await requireCollege();
    // Re-importing updates the same listings: each carries a stable external ID.
    await mapLimit(listings, 4, (listing) => communityRequest(tenantId, `${MODERATION}/feed`, "PUT", { ...listing, kind }));
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/staff/community");
  return { error: null, message: `${listings.length} listings from ${source} are up to date.` };
}

export async function importContests(): Promise<ActionState> {
  await requireCollege();
  return importListings(await upcomingCodeforcesContests(), "Codeforces", "contest");
}

export async function importIssues(): Promise<ActionState> {
  await requireCollege();
  return importListings(await goodFirstIssues(), "GitHub", "opensource");
}
