import { ArrowLeft } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { panel } from "@/app/admin/_dashboard/panel";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import type { AttemptReview } from "@/lib/api-types";
import { latestVersion } from "@/lib/server/exams";
import { gateway } from "@/lib/server/gateway";
import { requireCollege } from "@/lib/server/staff";
import { listAllStudents } from "@/lib/server/students";
import { cn, languageName } from "@/lib/utils";
import { SimilarityAlignPanel } from "./align-panel";

export const metadata: Metadata = { title: "Compare code" };

type Program = { attemptId: string; roll: string; language: string; source: string; title: string; position: number };

function programOf(review: AttemptReview, examItemId: string, roll: string): Program | null {
  const index = review.items.findIndex((item) => item.exam_item_id === examItemId);
  const item = review.items[index];
  if (!item?.latest_answer?.source) return null;
  return {
    attemptId: review.attempt.id,
    roll,
    language: item.latest_answer.language,
    source: item.latest_answer.source,
    title: item.title ?? "Question",
    position: item.position ?? index + 1,
  };
}

export default async function SimilarityComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<{ a?: string; b?: string; item?: string }>;
}) {
  const staff = await requireCollege();
  const { examId } = await params;
  const { a, b, item } = await searchParams;
  if (!a || !b || !item) notFound();

  let data: { versionId: string; versionTitle: string; left: Program; right: Program };
  try {
    const version = await latestVersion(staff.tenantId, examId);
    if (!version) throw new Error("This exam has no version.");
    const students = await listAllStudents(staff.tenantId);
    const roll = new Map(students.map((student) => [student.principal_id, student.enrollment_number]));
    const [leftReview, rightReview] = await Promise.all([
      gateway<AttemptReview>(`/submission/v1/tenants/${staff.tenantId}/attempts/${a}/review`),
      gateway<AttemptReview>(`/submission/v1/tenants/${staff.tenantId}/attempts/${b}/review`),
    ]);
    const left = programOf(leftReview, item, roll.get(leftReview.attempt.candidate_id) ?? a.slice(0, 8));
    const right = programOf(rightReview, item, roll.get(rightReview.attempt.candidate_id) ?? b.slice(0, 8));
    if (!left || !right) notFound();
    data = { versionId: version.id, versionTitle: version.title, left, right };
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    return (
      <div className="animate-enter">
        <PageHeader title="Compare code" />
        <LoadError error={error} />
      </div>
    );
  }

  const { versionId, versionTitle, left, right } = data;

  return (
    <div className="animate-enter">
      <Link href={`/staff/exams/${examId}/similarity`} className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" />
        {versionTitle} similarity
      </Link>
      <PageHeader
        title={`${left.roll} vs ${right.roll}`}
        description={`Question ${left.position}. Side-by-side view of each student's latest saved code.`}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {[left, right].map((program) => (
          <section key={program.attemptId} className={cn(panel, "overflow-hidden p-0")}>
            <div className="flex items-center justify-between border-b border-line bg-hover/40 px-4 py-2.5 text-sm">
              <Link href={`/staff/exams/${examId}/attempts/${program.attemptId}`} className="font-mono font-semibold text-brand hover:underline">
                {program.roll}
              </Link>
              <span className="text-ink-muted">{languageName(program.language)}</span>
            </div>
            <pre className="max-h-[70vh] overflow-auto px-4 py-3 font-mono text-[13px] leading-relaxed text-ink">
              {program.source.split("\n").map((line, index) => (
                <div key={index} className="flex">
                  <span className="w-10 shrink-0 select-none pr-3 text-right text-ink-subtle">{index + 1}</span>
                  <span>{line}</span>
                </div>
              ))}
            </pre>
          </section>
        ))}
      </div>
      <SimilarityAlignPanel
        tenantId={staff.tenantId}
        versionId={versionId}
        examItemId={item}
        attemptA={a}
        attemptB={b}
      />
    </div>
  );
}