"use client";

import { LoaderCircle, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormMessage } from "@/components/staff/form";
import { type TestDraft, blankTest, testsProblem } from "@/components/staff/question-wizard/model";
import { TestCasesEditor } from "@/components/staff/question-wizard/test-cases-editor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { saveTests } from "../actions";

const fresh = (): TestDraft[] => [blankTest(true), blankTest(false)];

/**
 * Test cases are encrypted when saved and never shown again, so this always
 * starts empty and saving replaces every existing test. It opens as a dialog
 * so changing tests does not leave the page the solution is checked on.
 */
export function TestsEditor({ versionId, expectedVersion, existing }: { versionId: string; expectedVersion: number; existing: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tests, setTests] = useState<TestDraft[]>(fresh);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await saveTests(versionId, expectedVersion, tests);
      if (result.error) return setError(result.error);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setTests(fresh());
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant={existing > 0 ? "secondary" : "primary"} size="sm">
          <Pencil />
          {existing > 0 ? "Replace tests" : "Add tests"}
        </Button>
      </DialogTrigger>
      <DialogContent title={existing > 0 ? "Replace the tests" : "Add the tests"} description="Sample tests are shown to students when they run. Hidden tests decide the marks." className="w-[min(94vw,1040px)]">
        <div className="min-h-0 space-y-4 overflow-y-auto p-6">
          {existing > 0 && (
            <p className="rounded-[var(--radius-control)] bg-warning-soft px-4 py-3 text-[13px] text-warning">
              {existing} tests are saved. They are encrypted and cannot be shown again, so this starts empty. Saving replaces all of them, and your model solution has to be checked again.
            </p>
          )}
          <TestCasesEditor tests={tests} onChange={(next) => { setTests(next); setError(null); }} />
          <FormMessage state={{ error }} />
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={save} disabled={pending || testsProblem(tests) !== null}>
            {pending && <LoaderCircle className="animate-spin" />}
            Save tests
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
