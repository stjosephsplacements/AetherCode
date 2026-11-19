import type { Metadata } from "next";
import { EmptyState, LoadError, PageHeader, Table } from "@/components/staff/page-header";
import { Pager } from "@/components/staff/pager";
import { Badge } from "@/components/ui/card";
import { paginate } from "@/lib/paginate";
import { type CollegeExam, listAllExams } from "@/lib/server/exams";
import { requirePlacement } from "@/lib/server/placement";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Placement exams" };

export default async function PlacementExamsPage({ searchParams }: { searchParams: Promise<{ published?: string; drafts?: string }> }) {
  const placement = await requirePlacement();
  let exams: CollegeExam[];
  try {
    const colleges = placement.colleges.map((c) => ({ id: c.id, display_name: c.name })) as { id: string; display_name: string }[];
    exams = await listAllExams(colleges);
  } catch (error) {
    return (
      <>
        <PageHeader title="Exams" />
        <LoadError error={error} />
      </>
    );
  }

  const withVersions = exams.filter((entry): entry is CollegeExam & { version: NonNullable<CollegeExam["version"]> } => entry.version !== null);
  const published = withVersions.filter((entry) => entry.version.status === "published");
  const drafts = withVersions.filter((entry) => entry.version.status !== "published");

  const pages = await searchParams;
  const publishedPage = paginate(published, pages.published);
  const draftPage = paginate(drafts, pages.drafts);

  return (
    <>
      <PageHeader
        title="Exams"
        description="Exams across all colleges. Placement exams assign to students via their placement track."
      />

      <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.01em] text-ink">Published ({published.length})</h2>
      {published.length === 0 ? (
        <EmptyState>No published exams across colleges.</EmptyState>
      ) : (
        <Table head={["Exam", "College", "Window", "Duration", "Status"]}>
          {publishedPage.rows.map((entry) => (
            <tr key={entry.version.id}>
              <td className="px-4 py-2.5 font-medium text-ink">{entry.version.title}</td>
              <td className="px-4 py-2.5 text-ink-muted">{entry.college.name}</td>
              <td className="px-4 py-2.5 text-[13px] text-ink-muted">
                {formatDateTime(entry.version.opens_at)} — {formatDateTime(entry.version.closes_at)}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-ink-muted">{Math.round(entry.version.duration_seconds / 60)} min</td>
              <td className="px-4 py-2.5"><Badge tone="success">Published</Badge></td>
            </tr>
          ))}
        </Table>
      )}
      <Pager meta={publishedPage} param="published" noun="published exams" />

      {drafts.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-[15px] font-semibold tracking-[-0.01em] text-ink">Drafts ({drafts.length})</h2>
          <Table head={["Exam", "College", "Status"]}>
            {draftPage.rows.map((entry) => (
              <tr key={entry.version.id}>
                <td className="px-4 py-2.5 font-medium text-ink">{entry.version.title}</td>
                <td className="px-4 py-2.5 text-ink-muted">{entry.college.name}</td>
                <td className="px-4 py-2.5"><Badge tone="neutral">{entry.version.status}</Badge></td>
              </tr>
            ))}
          </Table>
          <Pager meta={draftPage} param="drafts" noun="drafts" />
        </>
      )}
    </>
  );
}
