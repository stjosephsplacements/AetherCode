"use client";

import { useActionState, useState } from "react";
import { authButtonClass, authFieldClass } from "@/components/site/auth-card";
import { type ActionState, initialActionState } from "@/components/staff/form";
import { changePassword } from "./actions";

function PasswordField({
  id,
  name,
  label,
  autoComplete,
  autoFocus,
  minLength,
  hint,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  autoFocus?: boolean;
  minLength?: number;
  hint?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block font-mono text-[13px] text-ink">
        <span aria-hidden className="text-brand">
          &gt;{" "}
        </span>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          minLength={minLength}
          required
          className={`${authFieldClass} pr-20`}
        />
        <button
          type="button"
          onClick={() => setShown((value) => !value)}
          aria-label={shown ? "Hide password" : "Show password"}
          className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 font-mono text-[13px] text-ink-subtle transition-colors hover:text-ink"
        >
          {shown ? "[hide]" : "[show]"}
        </button>
      </div>
      {hint && <p className="font-mono text-[12px] text-ink-subtle">{hint}</p>}
    </div>
  );
}

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
      <PasswordField
        id="current-password"
        name="current_password"
        label={required ? "password you were given" : "current password"}
        autoComplete="current-password"
        autoFocus
      />
      <PasswordField
        id="new-password"
        name="new_password"
        label="new password"
        autoComplete="new-password"
        minLength={12}
        hint="at least 12 characters"
      />
      <PasswordField
        id="confirm-password"
        name="confirm_password"
        label="new password again"
        autoComplete="new-password"
        minLength={12}
      />
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
