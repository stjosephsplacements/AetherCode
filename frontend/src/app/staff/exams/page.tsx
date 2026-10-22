import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, LoadError, PageHeader } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { type ExamWithVersion, listExams } from "@/lib/server/exams";
import { requireCollege } from "@/lib/server/staff";
import { cn, formatDuration, formatWindow } from "@/lib/utils";

export const metadata: Metadata = { title: "Exams" };

export default async function ExamsPage() {
  const staff = await requireCollege();
  let exams: ExamWithVersion[];
  try {
    exams = (await listExams(staff.tenantId)).sort((a, b) => Date.parse(b.version?.opens_at ?? b.exam.created_at) - Date.parse(a.version?.opens_at ?? a.exam.created_at));
  } catch (error) {
    return (
      <>
        <PageHeader title="Exams" />
        <LoadError error={error} />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Exams"
        description="Build an exam from published questions, publish it, then assign it to a batch, a department or a placement department."
        actions={
          <Button asChild>
            <Link href="/staff/exams/new">
              <Plus />
              New exam
            </Link>
          </Button>
        }
      />
      {exams.length === 0 ? (
        <EmptyState>No exams yet.</EmptyState>
      ) : (
        <ul className="overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
          {exams.map(({ exam, version }, index) => (
            <li key={exam.id} className={cn(index > 0 && "border-t border-line")}>
              <Link href={`/staff/exams/${exam.id}`} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-hover">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-ink">{version?.title ?? "Untitled exam"}</p>
                  {version && (
                    <p className="mt-0.5 truncate text-[13px] text-ink-muted">
                      {formatWindow(version.opens_at, version.closes_at)}, {formatDuration(version.duration_seconds)}
                    </p>
                  )}
                </div>
                <Badge tone={version?.status === "published" ? "success" : "neutral"}>{version?.status === "published" ? "Published" : "Draft"}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
