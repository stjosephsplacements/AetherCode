"use client";

import { useActionState, useEffect, useRef } from "react";
import { announce } from "../../../actions";
import { Button, inputClass } from "@/components/ui";

export function AnnounceForm({ examId }: { examId: string }) {
  const [state, action, pending] = useActionState(announce.bind(null, examId), {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={action} className="flex flex-col gap-2 sm:flex-row">
      <input name="message" maxLength={1000} required placeholder="e.g. Q2: n ≤ 10^5, not 10^6" className={inputClass} />
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Announce"}
      </Button>
      {state.error && <p className="text-sm text-error">{state.error}</p>}
    </form>
  );
}
