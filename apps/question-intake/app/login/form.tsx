"use client";

import { useActionState } from "react";
import { Button, Label, field } from "@/components/ui";
import { type LoginState, loginAction } from "./actions";

export function LoginForm({ expired }: { expired: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, { error: expired ? "Your session ended. Sign in again." : null, identifier: "" });
  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="identifier">Username</Label>
        <input id="identifier" name="identifier" defaultValue={state.identifier} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required className={field} />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={field} />
      </div>
      {state.error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
