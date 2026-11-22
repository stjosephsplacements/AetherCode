"use client";

import { useActionState } from "react";
import { authButtonClass, authFieldClass } from "@/components/site/auth-card";
import { type ActionState, initialActionState } from "@/components/staff/form";
import { changePassword } from "./actions";

export function ChangePasswordForm({
  required,
  next,
}: {
  required: boolean;
  next: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(changePassword, initialActionState);
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <div className="space-y-2">
        <label htmlFor="current-password" className="block font-mono text-[13px] text-ink">
          <span aria-hidden className="text-brand">
            &gt;{" "}
          </span>
          {required ? "password you were given" : "current password"}
        </label>
        <input
          id="current-password"
          name="current_password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          className={authFieldClass}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="new-password" className="block font-mono text-[13px] text-ink">
          <span aria-hidden className="text-brand">
            &gt;{" "}
          </span>
          new password
        </label>
        <input
          id="new-password"
          name="new_password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          className={authFieldClass}
        />
        <p className="font-mono text-[12px] text-ink-subtle">at least 12 characters</p>
      </div>
      <div className="space-y-2">
        <label htmlFor="confirm-password" className="block font-mono text-[13px] text-ink">
          <span aria-hidden className="text-brand">
            &gt;{" "}
          </span>
          new password again
        </label>
        <input
          id="confirm-password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          className={authFieldClass}
        />
      </div>
      {state.error && (
        <p role="alert" className="rounded-xl border border-danger bg-danger-soft px-3.5 py-2.5 font-mono text-[13.5px] text-danger">
          [!] {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={authButtonClass}>
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
