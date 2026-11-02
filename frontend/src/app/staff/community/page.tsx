import type { Metadata } from "next";
import type { CommunityPost, FeedItem, InterviewExperience } from "@/lib/api-types";
import { inColleges } from "@/lib/server/colleges";
import { communityList } from "@/lib/server/community";
import { collegesFor, requireStaff } from "@/lib/server/staff";
import { type College, CommunityView } from "./view";

export const metadata: Metadata = { title: "Community" };

const TAB_IDS = ["interviews", "blogs", "listings"] as const;
const KIND_IDS = ["contest", "hackathon", "opensource"] as const;

export default async function CommunityPage({ searchParams }: { searchParams: Promise<{ tab?: string; college?: string; kind?: string; page?: string }> }) {
  const staff = await requireStaff();
  const { tab: requested, college: collegeParam, kind: kindParam, page } = await searchParams;
  const tab = TAB_IDS.find((candidate) => candidate === requested) ?? "interviews";
  const kind = KIND_IDS.find((candidate) => candidate === kindParam);
  const covered = collegesFor(staff, collegeParam);

  const perCollege = await inColleges(covered, async (collegeId) => {
    const [queue, posts, items] = await Promise.all([
      communityList<InterviewExperience>(collegeId, "moderation/interview-experiences"),
      communityList<CommunityPost>(collegeId, "moderation/posts"),
      communityList<FeedItem>(collegeId, "feed", { limit: 100 }),
    ]);
    return { queue, posts, items };
  });
  const tag = <T,>(pick: (value: { queue: InterviewExperience[]; posts: CommunityPost[]; items: FeedItem[] }) => T[]) =>
    perCollege.flatMap(({ college, value }) => pick(value ?? { queue: [], posts: [], items: [] }).map((row) => ({ row, college })));

  const all: College[] | undefined = staff.isPlatformAdmin ? staff.tenants.map((tenant) => ({ id: tenant.id, name: tenant.display_name })) : undefined;
  return (
    <CommunityView
      tab={tab}
      page={page}
      kind={kind}
      collegeParam={collegeParam}
      several={staff.isPlatformAdmin}
      all={all}
      fixed={staff.isPlatformAdmin && covered.length === 1 ? covered[0]!.id : undefined}
      queue={tag((value) => value.queue)}
      posts={tag((value) => value.posts)}
      items={tag((value) => value.items)}
      unreachable={perCollege.filter((entry) => entry.failed).map((entry) => entry.college.name)}
    />
  );
}
