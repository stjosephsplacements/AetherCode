import type { Metadata } from "next";
import { ActionForm, Field, TextArea, TextInput } from "@/components/staff/form";
import { PageHeader } from "@/components/staff/page-header";
import { Panel } from "@/components/ui/card";
import { requireCollege } from "@/lib/server/staff";
import { TIME_ZONE } from "@/lib/utils";
import { createExam } from "../actions";

export const metadata: Metadata = { title: "New exam" };

export default async function NewExamPage() {
  await requireCollege();
  return (
    <>
      <PageHeader title="New exam" description="Set the window and duration. You add questions on the next page." />
      <Panel className="p-5 sm:p-6">
        <ActionForm action={createExam} submitLabel="Create exam">
          <Field label="Title" htmlFor="exam-title">
            <TextInput id="exam-title" name="title" required maxLength={300} placeholder="Data Structures, Lab Test 2" />
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
          <Field label="Instructions" htmlFor="exam-instructions" hint="Shown on the exam's start page. Markdown.">
            <TextArea id="exam-instructions" name="instructions_markdown" placeholder={"- Two questions, 90 minutes.\n- Run checks the sample tests; hidden tests decide marks."} />
          </Field>
        </ActionForm>
      </Panel>
    </>
  );
}
