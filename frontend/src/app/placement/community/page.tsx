import type { Metadata } from "next";
import { ConfirmDelete } from "@/components/staff/confirm-delete";
import { EmptyState, LoadError, PageHeader, Table } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import type { CommunityPost } from "@/lib/api-types";
import { communityList } from "@/lib/server/community";
import { inColleges } from "@/lib/server/colleges";
import { requirePlacement } from "@/lib/server/placement";
import { formatDateTime } from "@/lib/utils";
import { removePlacementPost } from "./actions";
import { PlacementPostDialog } from "./post-dialog";

export const metadata: Metadata = { title: "Placement blogs" };

type Row = CommunityPost & { collegeId: string; college: string };

export default async function PlacementCommunityPage() {
  const placement = await requirePlacement();
  let rows: Row[] = [];
  try {
    const perCollege = await inColleges(placement.colleges, async (collegeId) =>
      communityList<CommunityPost>(collegeId, "moderation/posts"),
    );
    rows = perCollege.flatMap(({ college, value }) =>
      (value ?? []).map((post) => ({ ...post, collegeId: college.id, college: college.name })),
    );
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Blogs" />
        <LoadError error={error} />
      </div>
    );
  }

  const several = placement.colleges.length > 1;

  return (
    <div className="animate-enter space-y-6">
      <PageHeader
        title="Blogs"
        description="Publish placement notes into a college's student community feed."
        actions={<PlacementPostDialog colleges={placement.colleges} />}
      />
      {rows.length === 0 ? (
        <EmptyState>No posts yet. Write one for a college your tracks reach.</EmptyState>
      ) : (
        <Table head={["Title", ...(several ? ["College"] : []), "Status", "Updated", ""]}>
          {rows.map((post) => (
            <tr key={`${post.collegeId}:${post.id}`}>
              <td className="px-4 py-3 font-medium text-ink">{post.title}</td>
              {several && <td className="px-4 py-3 text-ink-muted">{post.college}</td>}
              <td className="px-4 py-3">
                <Badge tone={post.status === "published" ? "success" : "neutral"}>{post.status}</Badge>
              </td>
              <td className="px-4 py-3 text-[13px] text-ink-muted">{formatDateTime(post.updated_at)}</td>
              <td className="px-4 py-2 text-right">
                <ConfirmDelete
                  label="Delete"
                  title={`Delete ${post.title}?`}
                  description="Students will no longer see this post."
                  askReason={false}
                  onConfirm={async () => removePlacementPost(post.collegeId, post.id)}
                />
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
