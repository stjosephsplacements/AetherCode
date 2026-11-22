import type { Metadata } from "next";
import { panel } from "@/app/admin/_dashboard/panel";
import { ActionForm, Field, Select, TextArea, TextInput } from "@/components/staff/form";
import { EmptyState, LoadError, PageHeader } from "@/components/staff/page-header";
import { listPublishedPolicyVersions } from "@/lib/server/proctor-policies";
import { requirePlacement } from "@/lib/server/placement";
import { TIME_ZONE, cn } from "@/lib/utils";
import { ExamPolicyField } from "@/app/staff/exams/exam-policy-field";
import { createPlacementExam } from "../actions";

export const metadata: Metadata = { title: "New placement exam" };

export default async function PlacementNewExamPage() {
  const placement = await requirePlacement();
  if (placement.colleges.length === 0) {
    return (
      <div className="animate-enter">
        <PageHeader title="New exam" />
        <EmptyState>No colleges are reachable yet.</EmptyState>
      </div>
    );
  }
  if (placement.departmentIds.length === 0) {
    return (
      <div className="animate-enter">
        <PageHeader title="New exam" />
        <EmptyState>Ask a platform administrator to assign you a placement department first.</EmptyState>
      </div>
    );
  }

  const hostId = placement.colleges[0]!.id;
  let policies: Awaited<ReturnType<typeof listPublishedPolicyVersions>>;
  try {
    policies = await listPublishedPolicyVersions(hostId);
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="New exam" />
        <LoadError error={error} />
      </div>
    );
  }

  return (
    <div className="animate-enter">
      <PageHeader
        title="New exam"
        description="Hosted under one college for storage; you assign it to your placement tracks so students on those tracks receive it."
      />
      <section className={cn(panel, "mt-8 sm:p-6")}>
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Schedule</p>
        <ActionForm action={createPlacementExam} submitLabel="Create exam">
          <Field label="Host college" htmlFor="exam-college" hint="Where the exam record lives. Assignment still targets placement tracks.">
            <Select id="exam-college" name="college_id" required defaultValue={hostId}>
              {placement.colleges.map((college) => (
                <option key={college.id} value={college.id}>
                  {college.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title" htmlFor="exam-title">
            <TextInput id="exam-title" name="title" required maxLength={300} placeholder="ELITE coding drive — March" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Opens" htmlFor="exam-opens" hint={`College time (${TIME_ZONE})`}>
              <TextInput id="exam-opens" name="opens_at" type="datetime-local" required />
            </Field>
            <Field label="Closes" htmlFor="exam-closes" hint="Nobody can start after this.">
              <TextInput id="exam-closes" name="closes_at" type="datetime-local" required />
            </Field>
            <Field label="Duration (minutes)" htmlFor="exam-duration" hint="Each student's own timer.">
              <TextInput id="exam-duration" name="duration_minutes" type="number" min={1} max={720} defaultValue={90} required />
            </Field>
          </div>
          <ExamPolicyField policies={policies} />
          <Field label="Instructions" htmlFor="exam-instructions" hint="Shown on the exam's start page. Markdown.">
            <TextArea id="exam-instructions" name="instructions_markdown" placeholder={"- Two questions, 90 minutes.\n- Hidden tests decide marks."} />
          </Field>
        </ActionForm>
      </section>
    </div>
  );
}
