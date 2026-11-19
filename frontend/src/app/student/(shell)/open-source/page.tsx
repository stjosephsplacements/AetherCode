import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FEED_TITLES, FeedView } from "@/components/community/feed-view";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import type { FeedItem } from "@/lib/api-types";
import { communityList } from "@/lib/server/community";
import { requireViewer } from "@/lib/server/session";

export const metadata: Metadata = { title: FEED_TITLES.opensource.title };

export default async function Page({ searchParams }: { searchParams: Promise<{ saved?: string; page?: string }> }) {
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");
  const { saved: savedParam, page } = await searchParams;
  const saved = savedParam === "1";
  let items;
  try {
    items = await communityList<FeedItem>(viewer.tenantId, "feed", { kind: "opensource", upcoming: !saved, bookmarked: saved || undefined });
  } catch (error) {
    return (<><PageHeader title={FEED_TITLES.opensource.title} /><LoadError error={error} /></>);
  }
  return <FeedView kind="opensource" items={items} path="/student/open-source" saved={saved} page={page} />;
}
