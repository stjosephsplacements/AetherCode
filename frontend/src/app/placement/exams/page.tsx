import { Plus } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, LoadError, PageHeader, Table } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { type CollegeExam, listAllExams } from "@/lib/server/exams";
import { requirePlacement } from "@/lib/server/placement";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Placement exams" };

export default async function PlacementExamsPage() {
  const placement = await requirePlacement();
  let exams: CollegeExam[];
  try {
    const colleges = placement.colleges.map((c) => ({ id: c.id, display_name: c.name }));
    exams = await listAllExams(colleges);
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Exams" />
        <LoadError error={error} />
      </div>
    );
  }

  const withVersions = exams.filter((entry): entry is CollegeExam & { version: NonNullable<CollegeExam["version"]> } => entry.version !== null);
  const published = withVersions.filter((entry) => entry.version.status === "published");
  const drafts = withVersions.filter((entry) => entry.version.status !== "published");

  return (
    <div className="animate-enter space-y-6">
      <PageHeader
        title="Exams"
        description="Create exams under a host college, then assign them to your placement tracks."
        actions={
          <Button asChild size="sm">
            <Link href="/placement/exams/new">
              <Plus />
              New exam
            </Link>
          </Button>
        }
      />

      <section>
        <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.01em] text-ink">Published ({published.length})</h2>
        {published.length === 0 ? (
          <EmptyState>No published exams yet.</EmptyState>
        ) : (
          <Table head={["Exam", "College", "Window", "Duration", "Status"]}>
            {published.map((entry) => (
              <tr key={entry.version.id}>
                <td className="px-4 py-2.5">
                  <Link href={`/placement/exams/${entry.exam.id}?college=${encodeURIComponent(entry.college.id)}`} className="font-medium text-ink hover:text-brand hover:underline">
                    {entry.version.title}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-ink-muted">{entry.college.name}</td>
                <td className="px-4 py-2.5 text-[13px] text-ink-muted">
                  {formatDateTime(entry.version.opens_at)} — {formatDateTime(entry.version.closes_at)}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-ink-muted">{Math.round(entry.version.duration_seconds / 60)} min</td>
                <td className="px-4 py-2.5">
                  <Badge tone="success">Published</Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      {drafts.length > 0 && (
        <section>
          <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.01em] text-ink">Drafts ({drafts.length})</h2>
          <Table head={["Exam", "College", "Status"]}>
            {drafts.map((entry) => (
              <tr key={entry.version.id}>
                <td className="px-4 py-2.5">
                  <Link href={`/placement/exams/${entry.exam.id}?college=${encodeURIComponent(entry.college.id)}`} className="font-medium text-ink hover:text-brand hover:underline">
                    {entry.version.title}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-ink-muted">{entry.college.name}</td>
                <td className="px-4 py-2.5">
                  <Badge tone="neutral">{entry.version.status}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        </section>
      )}
    </div>
  );
}
