"use client";

import { useActionState } from "react";
import { changePassword } from "./actions";
import { Button, Field } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";

export function ChangePasswordForm() {
  const [error, action, pending] = useActionState(changePassword, null);
  return (
    <form action={action} className="space-y-4">
      <Field label="New password">
        <PasswordInput
          name="password"
          autoComplete="new-password"
          autoFocus
          required
          minLength={8}
        />
      </Field>
      <Field label="Confirm new password">
        <PasswordInput
          name="confirm"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </Field>
      {error && (
        <p role="alert" className="rounded-xl bg-error-soft px-3.5 py-2.5 text-sm font-medium text-error">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Set password"}
      </Button>
    </form>
  );
}
