import { ArrowLeft } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { panel } from "@/app/admin/_dashboard/panel";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import type { AttemptReview } from "@/lib/api-types";
import { gateway } from "@/lib/server/gateway";
import { requireCollege } from "@/lib/server/staff";
import { listAllStudents } from "@/lib/server/students";
import { cn, languageName } from "@/lib/utils";

export const metadata: Metadata = { title: "Compare submissions" };

function pane(label: string, attemptHref: string, language: string, source: string) {
  return (
    <section className={cn(panel, "overflow-hidden p-0")}>
      <div className="flex items-center justify-between border-b border-line bg-sunken px-4 py-2 text-sm">
        <Link href={attemptHref} className="font-semibold text-brand hover:underline">
          {label}
        </Link>
        <span className="text-xs text-ink-muted">{languageName(language)}</span>
      </div>
      <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-[13px] leading-relaxed">
        {source.split("\n").map((line, index) => (
          <div key={index} className="flex">
            <span className="w-10 shrink-0 select-none pr-3 text-right text-ink-subtle">{index + 1}</span>
            <span>{line || " "}</span>
          </div>
        ))}
      </pre>
    </section>
  );
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

  let data;
  try {
    const [left, right, students] = await Promise.all([
      gateway<AttemptReview>(`/submission/v1/tenants/${staff.tenantId}/attempts/${a}/review`),
      gateway<AttemptReview>(`/submission/v1/tenants/${staff.tenantId}/attempts/${b}/review`),
      listAllStudents(staff.tenantId),
    ]);
    const roll = new Map(students.map((student) => [student.principal_id, student.enrollment_number]));
    const leftItem = left.items.find((entry) => entry.exam_item_id === item);
    const rightItem = right.items.find((entry) => entry.exam_item_id === item);
    if (!leftItem?.latest_answer || !rightItem?.latest_answer) notFound();
    data = { left, right, leftItem, rightItem, roll };
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Compare" />
        <LoadError error={error} />
      </div>
    );
  }

  const { left, right, leftItem, rightItem, roll } = data;
  const title = leftItem.title ?? rightItem.title ?? "Question";
  const leftLabel = roll.get(left.attempt.candidate_id) ?? left.attempt.candidate_id.slice(0, 8);
  const rightLabel = roll.get(right.attempt.candidate_id) ?? right.attempt.candidate_id.slice(0, 8);

  return (
    <div className="animate-enter">
      <Link href={`/staff/exams/${examId}/similarity`} className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" />
        Similarity report
      </Link>
      <PageHeader title={`${leftLabel} vs ${rightLabel}`} description={`${title} · side by side. A high similarity score is a reason to look, not proof.`} />
      <div className="grid gap-4 lg:grid-cols-2">
        {pane(leftLabel, `/staff/exams/${examId}/attempts/${a}`, leftItem.latest_answer!.language, leftItem.latest_answer!.source)}
        {pane(rightLabel, `/staff/exams/${examId}/attempts/${b}`, rightItem.latest_answer!.language, rightItem.latest_answer!.source)}
      </div>
    </div>
  );
}
