"use client";

import { Plus } from "lucide-react";
import { ActionForm, Field, TextArea, TextInput } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { TIME_ZONE } from "@/lib/utils";
import { createExam } from "./actions";

/** Create an exam without leaving the page; on success the action opens its editor to add questions. */
export function NewExamDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          New exam
        </Button>
      </DialogTrigger>
      <DialogContent title="New exam" description="Set the window and duration. You add questions next.">
        <div className="min-h-0 overflow-y-auto p-6">
          <ActionForm action={createExam} submitLabel="Create exam">
            <Field label="Title" htmlFor="exam-title">
              <TextInput id="exam-title" name="title" required maxLength={300} placeholder="Data Structures, Lab Test 2" autoFocus />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Opens" htmlFor="exam-opens" hint={`College time (${TIME_ZONE})`}>
                <TextInput id="exam-opens" name="opens_at" type="datetime-local" required />
              </Field>
              <Field label="Closes" htmlFor="exam-closes" hint="Nobody can start after this.">
                <TextInput id="exam-closes" name="closes_at" type="datetime-local" required />
              </Field>
            </div>
            <Field label="Duration (minutes)" htmlFor="exam-duration" hint="Each student's own timer." className="sm:max-w-[50%]">
              <TextInput id="exam-duration" name="duration_minutes" type="number" min={1} max={720} defaultValue={90} required />
            </Field>
            <Field label="Instructions" htmlFor="exam-instructions" hint="Shown on the exam's start page. Markdown.">
              <TextArea id="exam-instructions" name="instructions_markdown" placeholder={"- Two questions, 90 minutes.\n- Run checks the sample tests; hidden tests decide marks."} />
            </Field>
          </ActionForm>
        </div>
      </DialogContent>
    </Dialog>
  );
}
