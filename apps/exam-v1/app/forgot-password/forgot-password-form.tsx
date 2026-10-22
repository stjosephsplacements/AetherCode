"use client";

import { useActionState } from "react";
import Link from "next/link";
import { forgotPassword } from "./actions";
import { Button, Field, inputClass } from "@/components/ui";

export function ForgotPasswordForm() {
  const [message, action, pending] = useActionState(forgotPassword, null);
  const sent = message?.startsWith("We've sent");
  return sent ? (
    <div className="space-y-4">
      <p className="rounded-xl bg-pass-soft px-3.5 py-2.5 text-sm font-medium text-pass">{message}</p>
      <Link href="/login" className="mt-2 block text-center text-sm text-muted hover:text-ink">
        Back to sign in
      </Link>
    </div>
  ) : (
    <form action={action} className="space-y-4">
      <Field label="Username or roll number">
        <input name="username" autoComplete="username" autoFocus required className={inputClass} />
      </Field>
      <Field label="Your email address">
        <input name="email" type="email" autoComplete="email" required className={inputClass} placeholder="you@example.com" />
      </Field>
      {message && (
        <p role="alert" className="rounded-xl bg-error-soft px-3.5 py-2.5 text-sm font-medium text-error">
          {message}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Send reset link"}
      </Button>
      <Link href="/login" className="mt-2 block text-center text-sm text-muted hover:text-ink">
        Back to sign in
      </Link>
    </form>
  );
}
