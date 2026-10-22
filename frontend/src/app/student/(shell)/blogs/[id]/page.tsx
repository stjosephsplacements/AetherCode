import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Markdown } from "@/components/markdown";
import type { CommunityPost } from "@/lib/api-types";
import { type GatewayError } from "@/lib/server/gateway";
import { communityRequest } from "@/lib/server/community";
import { requireViewer } from "@/lib/server/session";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Blog" };

export default async function BlogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");
  let post: CommunityPost;
  try {
    post = await communityRequest<CommunityPost>(viewer.tenantId, `posts/${encodeURIComponent(id)}`, "GET");
  } catch (error) {
    if ((error as GatewayError).status === 404 || (error as GatewayError).status === 400) notFound();
    throw error;
  }
  return (
    <article className="mx-auto max-w-[720px] animate-enter">
      <Link href="/student/blogs" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        Blogs
      </Link>
      <h1 className="display mt-6 text-[2.1rem] text-ink sm:text-[2.4rem]">{post.title}</h1>
      <p className="mt-2 text-[13px] text-ink-muted">{post.published_at && formatDateTime(post.published_at)}</p>
      <div className="mt-8">
        <Markdown>{post.body_markdown ?? ""}</Markdown>
      </div>
    </article>
  );
}
