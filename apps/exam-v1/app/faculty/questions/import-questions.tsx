"use client";

import { useActionState, useRef } from "react";
import { importQuestions } from "../actions";
import { buttonClass } from "@/components/ui";

export function ImportQuestions() {
  const [state, action, pending] = useActionState(importQuestions, {});
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={action} className="flex items-center gap-3">
      <label className={`${buttonClass("secondary")} cursor-pointer`}>
        {pending ? "Importing…" : "Import file"}
        <input
          type="file"
          name="file"
          accept=".json,application/json"
          className="sr-only"
          disabled={pending}
          onChange={() => form.current?.requestSubmit()}
        />
      </label>
      {state.error && <span className="text-sm text-error">{state.error}</span>}
      {state.imported !== undefined && <span className="text-sm text-pass">Imported {state.imported} question{state.imported === 1 ? "" : "s"}.</span>}
    </form>
  );
}
