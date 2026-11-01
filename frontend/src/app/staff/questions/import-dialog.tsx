"use client";

import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ImportQuestionForm } from "./import-form";

/** Import without leaving the list. */
export function ImportDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Upload />
          Import
        </Button>
      </DialogTrigger>
      <DialogContent title="Import questions" description="Add questions from a file a college administrator exported, or from the old exam app's question export. They arrive as your drafts, tests included, and each needs its own check before it can be published.">
        <div className="p-6">
          <ImportQuestionForm />
        </div>
      </DialogContent>
    </Dialog>
  );
}
