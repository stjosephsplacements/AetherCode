"use client";

import { useActionState } from "react";
import { extendExam } from "../../../actions";
import { Button } from "@/components/ui";

export function ExtendExamForm({ examId }: { examId: string }) {
  const [state, action, pending] = useActionState(extendExam.bind(null, examId), {});
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm("Add this time for every student still in the exam?")) event.preventDefault();
      }}
      className="grid gap-3"
    >
      <div className="flex items-center gap-2">
        <input name="minutes" type="number" min={1} max={240} defaultValue={10} required className="w-20 rounded-lg border border-line-strong px-2 py-1.5 text-sm" />
        <span className="text-sm text-muted">minutes for everyone</span>
        <Button type="submit" variant="secondary" size="sm" disabled={pending} className="ml-auto">
          {pending ? "Extending…" : "Extend"}
        </Button>
      </div>
      <label className="flex items-start gap-2 text-xs text-muted">
        <input type="checkbox" name="reopen" className="mt-0.5 size-3.5 accent-brand" />
        Also reopen attempts the clock ended in the last 30 minutes (never ones a student ended).
      </label>
      {state.error && <p className="text-sm text-error">{state.error}</p>}
      {state.extended !== undefined && <p className="text-sm text-pass">Extended {state.extended} attempt{state.extended === 1 ? "" : "s"}; the exam window closes later too.</p>}
    </form>
  );
}
