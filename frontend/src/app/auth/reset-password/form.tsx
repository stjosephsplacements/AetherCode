"use client";

import { useActionState } from "react";
import { authButtonClass, authFieldClass } from "@/components/site/auth-card";
import { type ResetState, completeReset } from "./actions";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(completeReset, { error: null });
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="token" value={token} />
      <div className="space-y-2">
        <label htmlFor="password" className="block font-mono text-[13px] text-ink">
          <span aria-hidden className="text-brand">&gt; </span>new password
        </label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required autoFocus className={authFieldClass} />
        <p className="font-mono text-[12px] text-ink-subtle">At least 12 characters.</p>
      </div>
      <div className="space-y-2">
        <label htmlFor="confirm" className="block font-mono text-[13px] text-ink">
          <span aria-hidden className="text-brand">&gt; </span>new password again
        </label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required className={authFieldClass} />
      </div>
      {state.error && (
        <p role="alert" className="rounded-xl border border-danger bg-danger-soft px-3.5 py-2.5 font-mono text-[13.5px] text-danger">
          [!] {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={authButtonClass}>
        {pending ? "Saving..." : "Save password"}
      </button>
    </form>
  );
}
