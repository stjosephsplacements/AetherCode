"use client";

import { useActionState } from "react";
import { authButtonClass, authFieldClass } from "@/components/site/auth-card";
import { type ForgotState, requestReset } from "./actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(requestReset, { error: null, sent: false, email: "" });
  if (state.sent) {
    return (
      <p role="status" className="rounded-2xl border border-line-strong bg-surface/50 px-4 py-3.5 font-mono text-[13.5px] leading-relaxed text-ink">
        If an account uses that email and password reset by email is set up on this site, a link is on its way. If nothing arrives in a few minutes, ask your exam administrator to reset your password.
      </p>
    );
  }
  return (
    <form action={action} className="space-y-5" noValidate>
      <div className="space-y-2">
        <label htmlFor="email" className="block font-mono text-[13px] text-ink">
          <span aria-hidden className="text-brand">&gt; </span>email address
        </label>
        <input id="email" name="email" type="email" defaultValue={state.email} autoComplete="email" autoCapitalize="none" spellCheck={false} required autoFocus className={authFieldClass} />
      </div>
      {state.error && (
        <p role="alert" className="rounded-xl border border-danger bg-danger-soft px-3.5 py-2.5 font-mono text-[13.5px] text-danger">
          [!] {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={authButtonClass}>
        {pending ? "Sending..." : "Email me a link"}
      </button>
      <p className="font-mono text-[12.5px] leading-relaxed text-ink-subtle">
        Students sign in with a roll number and have no email on file: ask your invigilator or faculty to reset your password.
      </p>
    </form>
  );
}
