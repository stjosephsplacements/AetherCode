"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import type { FeedKind } from "@/lib/api-types";
import type { ListingDraft } from "@/lib/external";
import { actionError } from "@/lib/server/actions";
import { communityRequest } from "@/lib/server/community";
import { mapLimit } from "@/lib/server/exams";
import { goodFirstIssues, upcomingCodeforcesContests } from "@/lib/server/platforms";
import { ALL_COLLEGES, collegeFor, collegesFor, requireStaff } from "@/lib/server/staff";
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

/** The college a form names (a root admin picks one); anyone else always acts in their own. */
async function collegeOf(form: FormData): Promise<string> {
  return collegeFor(await requireStaff(), String(form.get("college_id") ?? ""));
}

export async function reviewExperience(form: FormData): Promise<void> {
  const tenantId = await collegeOf(form);
  await communityRequest(tenantId, `${MODERATION}/interview-experiences/${String(form.get("id"))}/review`, "POST", {
    approve: form.get("approve") === "true",
    note: String(form.get("note") ?? ""),
  });
  revalidatePath("/staff/community");
}

export async function savePost(_previous: ActionState, form: FormData): Promise<ActionState> {
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
  revalidatePath("/staff/community");
  return { error: null, message: "Saved." };
}

export async function removePost(collegeId: string, id: string): Promise<ActionState> {
  try {
    await communityRequest(collegeFor(await requireStaff(), collegeId), `${MODERATION}/posts/${id}`, "DELETE");
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/staff/community");
  return { error: null, message: "Deleted." };
}

export async function saveListing(_previous: ActionState, form: FormData): Promise<ActionState> {
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
  revalidatePath("/staff/community");
  return { error: null, message: "Saved." };
}

export async function removeListing(collegeId: string, id: string): Promise<ActionState> {
  try {
    await communityRequest(collegeFor(await requireStaff(), collegeId), `${MODERATION}/feed/${id}`, "DELETE");
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/staff/community");
  return { error: null, message: "Deleted." };
}

/** Colleges an import covers: the one named, or every college when a root admin picks "all". */
async function importTargets(form: FormData): Promise<string[]> {
  const staff = await requireStaff();
  const named = String(form.get("college_id") ?? "");
  if (staff.isPlatformAdmin && named === ALL_COLLEGES) return collegesFor(staff, undefined).map((college) => college.id);
  return [collegeFor(staff, named)];
}

async function importListings(form: FormData, listings: ListingDraft[] | null, source: string, kind: FeedKind): Promise<ActionState> {
  if (listings === null) return { error: `${source} did not answer. Try again in a few minutes.` };
  if (listings.length === 0) return { error: null, message: `${source} has nothing new to list.` };
  try {
    const targets = await importTargets(form);
    // Re-importing updates the same listings: each carries a stable external ID.
    for (const tenantId of targets) await mapLimit(listings, 4, (listing) => communityRequest(tenantId, `${MODERATION}/feed`, "PUT", { ...listing, kind }));
    revalidatePath("/staff/community");
    return { error: null, message: `${listings.length} listings from ${source} are up to date${targets.length > 1 ? ` in ${targets.length} colleges` : ""}.` };
  } catch (error) {
    return failure(error);
  }
}

export async function importContests(_previous: ActionState, form: FormData): Promise<ActionState> {
  return importListings(form, await upcomingCodeforcesContests(), "Codeforces", "contest");
}

export async function importIssues(_previous: ActionState, form: FormData): Promise<ActionState> {
  return importListings(form, await goodFirstIssues(), "GitHub", "opensource");
}
