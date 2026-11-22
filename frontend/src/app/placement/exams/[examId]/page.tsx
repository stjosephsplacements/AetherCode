import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { panel } from "@/app/admin/_dashboard/panel";
import { ActionForm, Field, TextInput } from "@/components/staff/form";
import { EmptyState, LoadError, PageHeader } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ExamVersion, ExamVersionContent, Page, QuestionDetail } from "@/lib/api-types";
import { latestVersion } from "@/lib/server/exams";
import { gateway } from "@/lib/server/gateway";
import { listPlacement } from "@/lib/server/directory";
import { requirePlacement } from "@/lib/server/placement";
import { placementDepartmentOptions } from "@/lib/server/placement-org";
import { formatDateTime, cn } from "@/lib/utils";
import { QuestionPicker } from "@/app/staff/exams/[examId]/question-picker";
import { addPlacementQuestion, publishPlacementExam } from "../actions";
import { AssignTracks } from "../assign-tracks";

export const metadata: Metadata = { title: "Placement exam" };

function localInput(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default async function PlacementExamPage({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<{ college?: string }>;
}) {
  const placement = await requirePlacement();
  const { examId } = await params;
  const collegeId = (await searchParams).college ?? "";
  if (!collegeId || !placement.colleges.some((college) => college.id === collegeId)) notFound();

  let version: ExamVersion | null;
  let content: ExamVersionContent;
  let questions: { id: string; title: string; difficulty: string; tags: string[] }[];
  let tracks: { id: string; label: string }[];
  try {
    version = await latestVersion(collegeId, examId);
    if (!version) notFound();
    content = await gateway<ExamVersionContent>(`/assessment/v1/tenants/${collegeId}/exam-versions/${version.id}/content`);
    const published = (await gateway<Page<QuestionDetail>>("/question-bank/v1/questions?limit=100&status=published")).items;
    questions = published.map(({ question_version: q }) => ({
      id: q.id,
      title: q.title,
      difficulty: q.difficulty,
      tags: (q.tags ?? []).map((tag) => tag.name),
    }));
    const directory = await listPlacement();
    tracks = placementDepartmentOptions(directory).filter((track) => placement.departmentIds.includes(track.id));
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Exam" />
        <LoadError error={error} />
      </div>
    );
  }

  const collegeName = placement.colleges.find((college) => college.id === collegeId)?.name ?? "College";
  const items = content.sections.flatMap((section) => section.items);
  const placementRules = content.assignment_rules.filter((rule) => rule.target_type === "placement_department");
  const trackName = new Map(tracks.map((track) => [track.id, track.label] as const));

  return (
    <div className="animate-enter space-y-6">
      <PageHeader
        title={version.title}
        description={`${collegeName} · ${formatDateTime(version.opens_at)} — ${formatDateTime(version.closes_at)} · ${Math.round(version.duration_seconds / 60)} min`}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/placement/exams">Back to exams</Link>
          </Button>
        }
      />

      <section className={cn(panel)}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={version.status === "published" ? "success" : "neutral"}>{version.status}</Badge>
          <span className="text-[13px] text-ink-muted">{items.length} question{items.length === 1 ? "" : "s"}</span>
        </div>
        {version.status !== "published" && (
          <div className="mt-4">
            <ActionForm action={publishPlacementExam} submitLabel="Publish">
              <input type="hidden" name="college_id" value={collegeId} />
              <input type="hidden" name="exam_id" value={examId} />
              <input type="hidden" name="version_id" value={version.id} />
            </ActionForm>
          </div>
        )}
      </section>

      <section className={cn(panel)}>
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Questions</h2>
        {items.length === 0 ? (
          <EmptyState>Add published questions from the shared bank.</EmptyState>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-[13.5px]">
                <span className="font-medium text-ink">{item.question_title ?? item.question_version_id.slice(0, 8)}</span>
                <span className="font-mono text-xs text-ink-muted">{item.maximum_score} pts</span>
              </li>
            ))}
          </ul>
        )}
        {questions.length > 0 && (
          <div className="mt-4 border-t border-line pt-4">
            <ActionForm action={addPlacementQuestion} submitLabel="Add question">
              <input type="hidden" name="college_id" value={collegeId} />
              <input type="hidden" name="exam_id" value={examId} />
              <input type="hidden" name="version_id" value={version.id} />
              <QuestionPicker questions={questions} />
              <Field label="Marks" htmlFor="max-score">
                <TextInput id="max-score" name="maximum_score" type="number" min={1} max={100} defaultValue={10} required />
              </Field>
            </ActionForm>
          </div>
        )}
      </section>

      <section className={cn(panel)}>
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Placement tracks</h2>
        <p className="mt-1 text-[13px] text-ink-muted">Students on these tracks receive the exam (ADR-0026).</p>
        {placementRules.length > 0 && (
          <ul className="mt-3 divide-y divide-line">
            {placementRules.map((rule) => (
              <li key={rule.id} className="py-2 text-[13.5px] text-ink">
                {trackName.get(rule.target_id) ?? rule.target_id.slice(0, 8)} · {rule.assigned_candidates} candidates
              </li>
            ))}
          </ul>
        )}
        {tracks.length === 0 ? (
          <EmptyState>No tracks assigned to you.</EmptyState>
        ) : version.status === "published" ? (
          <div className="mt-4">
            <AssignTracks
              collegeId={collegeId}
              examId={examId}
              versionId={version.id}
              opens={localInput(version.opens_at)}
              closes={localInput(version.closes_at)}
              tracks={tracks}
            />
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-ink-muted">Publish the exam before assigning tracks.</p>
        )}
      </section>
    </div>
  );
}
