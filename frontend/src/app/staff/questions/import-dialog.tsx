"use client";

import { UploadSimple } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ImportQuestionForm } from "./import-form";
import { IntakeImportForm } from "./intake-import-form";
import type { IntakeTopicOption } from "./actions";

/** Import without leaving the list. */
export function ImportDialog({ intakeTopics = [] }: { intakeTopics?: IntakeTopicOption[] }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <UploadSimple />
          Import
        </Button>
      </DialogTrigger>
      <DialogContent title="Import questions" description="Add questions from question intake, a college export file, or the old exam app. Each arrives as a draft; model checks must pass before publish.">
        <div className="space-y-8 p-6">
          <IntakeImportForm topics={intakeTopics} />
          <ImportQuestionForm />
        </div>
      </DialogContent>
    </Dialog>
  );
}
