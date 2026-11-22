"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createContest } from "./actions";

export function CreateContestForm({ collegeId }: { collegeId: string }) {
  return (
    <form className="grid gap-3 rounded-lg border border-line p-4 md:grid-cols-2" action={createContest.bind(null, collegeId)}>
      <Input name="title" placeholder="Title" required />
      <Input name="question_ids" placeholder="Practice question UUIDs (comma-separated)" required />
      <Input name="starts_at" type="datetime-local" required />
      <Input name="ends_at" type="datetime-local" required />
      <Textarea name="description" placeholder="Description" className="md:col-span-2" rows={3} />
      <div className="md:col-span-2">
        <Button type="submit">Create contest</Button>
      </div>
    </form>
  );
}