import type { Metadata } from "next";
import { PageHeader } from "@/components/staff/page-header";
import { QuestionForm } from "@/components/staff/question-form";
import { Panel } from "@/components/ui/card";
import { requireStaff } from "@/lib/server/staff";
import { createQuestion } from "../actions";

export const metadata: Metadata = { title: "New question" };

export default async function NewQuestionPage() {
  await requireStaff();
  return (
    <>
      <PageHeader title="New question" description="Write the statement first. You add tests on the next page, then publish." />
      <Panel className="p-5 sm:p-6">
        <QuestionForm action={createQuestion} />
      </Panel>
    </>
  );
}
