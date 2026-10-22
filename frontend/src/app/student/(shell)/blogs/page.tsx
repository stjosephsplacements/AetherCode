import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import type { CommunityPost } from "@/lib/api-types";
import { communityList } from "@/lib/server/community";
import { requireViewer } from "@/lib/server/session";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Blogs" };

export default async function BlogsPage({ searchParams }: { searchParams: Promise<{ tag?: string }> }) {
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");
  const tag = (await searchParams).tag?.trim().toLowerCase();
  const posts = await communityList<CommunityPost>(viewer.tenantId, "posts", { tag });
  return (
    <div className="animate-enter">
      <h1 className="display text-[2.25rem] text-ink sm:text-[2.6rem]">Blogs</h1>
      <p className="mt-2 max-w-[60ch] text-[15px] text-ink-muted">Preparation guides and announcements from your placement team.</p>
      {tag && (
        <p className="mt-4 text-sm text-ink-muted">
          Tagged <Badge tone="brand">{tag}</Badge>{" "}
          <Link href="/student/blogs" className="ml-2 text-brand hover:underline">
            Show all
          </Link>
        </p>
      )}
      <div className="mt-6">
        {posts.length === 0 ? (
          <EmptyState>{tag ? `No posts tagged “${tag}”.` : "No posts yet."}</EmptyState>
        ) : (
          <ul className="overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
            {posts.map((post, index) => (
              <li key={post.id} className={cn("px-5 py-4", index > 0 && "border-t border-line")}>
                <Link href={`/student/blogs/${post.id}`} className="text-[16px] font-medium text-ink hover:text-brand">
                  {post.title}
                </Link>
                <p className="mt-0.5 text-[12px] text-ink-subtle">{post.published_at && formatDateTime(post.published_at)}</p>
                <p className="mt-1.5 line-clamp-2 text-sm text-ink-muted">{post.excerpt}</p>
                {post.tags.length > 0 && (
                  <p className="mt-2 flex flex-wrap gap-1.5">
                    {post.tags.map((name) => (
                      <Link key={name} href={`/student/blogs?tag=${encodeURIComponent(name)}`} className="rounded-full bg-hover px-2.5 py-0.5 text-[12px] text-ink-muted hover:text-ink">
                        {name}
                      </Link>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
