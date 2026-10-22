import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FEED_TITLES, FeedView } from "@/components/community/feed-view";
import type { FeedItem } from "@/lib/api-types";
import { communityList } from "@/lib/server/community";
import { requireViewer } from "@/lib/server/session";

export const metadata: Metadata = { title: FEED_TITLES.hackathon.title };

export default async function Page({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");
  const saved = (await searchParams).saved === "1";
  const items = await communityList<FeedItem>(viewer.tenantId, "feed", { kind: "hackathon", upcoming: !saved, bookmarked: saved || undefined });
  return <FeedView kind="hackathon" items={items} path="/student/hackathons" saved={saved} />;
}
