"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import type { ProfileLink } from "@/lib/api-types";
import { actionError } from "@/lib/server/actions";
import { brandFor } from "@/lib/server/branding";
import { communityList } from "@/lib/server/community";
import { gateway } from "@/lib/server/gateway";
import { platformStats } from "@/lib/server/platforms";
import { requireViewer } from "@/lib/server/session";

const LABEL: Record<string, string> = { leetcode: "LeetCode", codeforces: "Codeforces", github: "GitHub", codechef: "CodeChef", hackerrank: "HackerRank", atcoder: "AtCoder", skillrack: "SkillRack" };

/**
 * Publishes (or hides) the student's profile card. The card holds only what the student chose to show,
 * built here from their own account and linked handles; turning it off makes /u/<address> a 404 at once.
 */
export async function savePublicProfile(_previous: ActionState, form: FormData): Promise<ActionState> {
  const viewer = await requireViewer();
  if (!viewer.tenantId) return { error: "Your account is not in a college yet." };
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const enabled = form.get("enabled") === "on";
  const links = form.get("show_links") === "on" ? await communityList<ProfileLink>(viewer.tenantId, "profile-links").catch(() => []) : [];
  const stats = links.length ? await platformStats(links).catch(() => []) : [];
  const college = form.get("show_college") === "on" ? ((await brandFor(viewer.tenantId)).name ?? "") : "";
  try {
    await gateway(`/user/v1/profiles/${viewer.principalId}/public?tenant_id=${viewer.tenantId}`, {
      method: "PUT",
      body: {
        slug: text("slug").toLowerCase(),
        enabled,
        content: {
          name: viewer.displayName || viewer.username,
          headline: text("headline"),
          bio: text("bio"),
          college,
          skills: text("skills").split(",").map((skill) => skill.trim()).filter(Boolean),
          links: stats.map((stat) => ({ platform: LABEL[stat.platform] ?? stat.platform, handle: stat.handle, url: stat.url })),
        },
      },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/student/profile");
  revalidatePath(`/u/${text("slug").toLowerCase()}`);
  return { error: null, message: enabled ? "Your profile is public." : "Your profile is hidden." };
}
