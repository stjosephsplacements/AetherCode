import type { Metadata } from "next";
import type { AccountSummary, CommunityPost, FeedItem, InterviewExperience } from "@/lib/api-types";
import { authorName } from "@/lib/author-name";
import { inColleges } from "@/lib/server/colleges";
import { communityList } from "@/lib/server/community";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { describeAccounts } from "@/lib/server/people";
import { collegesFor, requireStaff } from "@/lib/server/staff";
import { CommunityView } from "./view";

export const metadata: Metadata = { title: "Community" };

const TAB_IDS = ["interviews", "blogs", "listings"] as const;
const KIND_IDS = ["contest", "hackathon", "opensource"] as const;

type Bundle = { queue: InterviewExperience[]; posts: CommunityPost[]; items: FeedItem[]; names: Map<string, AccountSummary> };

export default async function CommunityPage({ searchParams }: { searchParams: Promise<{ tab?: string; kind?: string; page?: string }> }) {
  const staff = await requireStaff();
  const { tab: requested, kind: kindParam, page } = await searchParams;
  const tab = TAB_IDS.find((candidate) => candidate === requested) ?? "interviews";
  const kind = KIND_IDS.find((candidate) => candidate === kindParam);
  const covered = collegesFor(staff);

  let perCollege;
  try {
    perCollege = await inColleges(covered, async (collegeId) => {
      const [queue, posts, items] = await Promise.all([
        communityList<InterviewExperience>(collegeId, "moderation/interview-experiences"),
        communityList<CommunityPost>(collegeId, "moderation/posts"),
        communityList<FeedItem>(collegeId, "feed", { limit: 100 }),
      ]);
      const authorIds = [
        ...queue.map((row) => row.author_id),
        ...posts.map((row) => row.author_id),
        ...items.map((row) => row.created_by),
      ].filter((id): id is string => Boolean(id));
      const names = authorIds.length
        ? await describeAccounts(collegeId, authorIds).catch(() => new Map<string, AccountSummary>())
        : new Map<string, AccountSummary>();
      return { queue, posts, items, names } satisfies Bundle;
    });
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Community" />
        <LoadError error={error} />
      </div>
    );
  }
  const tag = <T extends { author_id?: string | null } | { created_by?: string }>(
    pick: (value: Bundle) => T[],
    idOf: (row: T) => string | null | undefined,
  ) =>
    perCollege.flatMap(({ college, value }) => {
      const bundle = value ?? { queue: [], posts: [], items: [], names: new Map<string, AccountSummary>() };
      return pick(bundle).map((row) => ({ row, college, authorName: authorName(bundle.names, idOf(row)) }));
    });

  return (
    <CommunityView
      tab={tab}
      page={page}
      kind={kind}
      several={false}
      queue={tag((value) => value.queue, (row) => row.author_id)}
      posts={tag((value) => value.posts, (row) => row.author_id)}
      items={tag((value) => value.items, (row) => row.created_by)}
      unreachable={perCollege.filter((entry) => entry.failed).map((entry) => entry.college.name)}
    />
  );
}
