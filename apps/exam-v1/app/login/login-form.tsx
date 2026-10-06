"use client";

import { useActionState } from "react";
import { login } from "./actions";
import { Button, Field, inputClass } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";

export function LoginForm() {
  const [error, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="space-y-4">
      <Field label="Username or roll number">
        <input name="username" autoComplete="username" autoFocus required className={inputClass} />
      </Field>
      <Field label="Password">
        <PasswordInput name="password" autoComplete="current-password" required />
      </Field>
      {error && (
        <p role="alert" className="rounded-xl bg-error-soft px-3.5 py-2.5 text-sm font-medium text-error">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
