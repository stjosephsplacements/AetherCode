"use client";

import { useActionState } from "react";
import Link from "next/link";
import { resetPassword } from "./actions";
import { Button, Field } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, null);

  return state === "ok" ? (
    <div className="space-y-4">
      <p className="rounded-xl bg-pass-soft px-3.5 py-2.5 text-sm font-medium text-pass">
        Your password has been reset. You can now sign in with your new password.
      </p>
      <Link href="/login" className="mt-2 block text-center text-sm font-semibold text-brand hover:underline">
        Sign in
      </Link>
    </div>
  ) : (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Field label="New password">
        <PasswordInput name="password" autoComplete="new-password" autoFocus required minLength={8} />
      </Field>
      <Field label="Confirm new password">
        <PasswordInput name="confirm" autoComplete="new-password" required minLength={8} />
      </Field>
      {state && state !== "ok" && (
        <p role="alert" className="rounded-xl bg-error-soft px-3.5 py-2.5 text-sm font-medium text-error">
          {state}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Resetting…" : "Reset password"}
      </Button>
    </form>
  );
}
