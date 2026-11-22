"use client";

import { TextArea, TextInput } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { createContest } from "./actions";

export function CreateContestForm({ collegeId }: { collegeId: string }) {
  return (
    <form className="grid gap-3 rounded-lg border border-line p-4 md:grid-cols-2" action={createContest.bind(null, collegeId)}>
      <TextInput name="title" placeholder="Title" required />
      <TextInput name="question_ids" placeholder="Practice question UUIDs (comma-separated)" required />
      <TextInput name="starts_at" type="datetime-local" required />
      <TextInput name="ends_at" type="datetime-local" required />
      <TextArea name="description" placeholder="Description" className="md:col-span-2" rows={3} />
      <div className="md:col-span-2">
        <Button type="submit">Create contest</Button>
      </div>
    </form>
  );
}