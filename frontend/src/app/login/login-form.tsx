"use client";

import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useActionState, useState } from "react";
import { ROLL_HANDOFF } from "@/components/site/roll-box";
import { Button } from "@/components/ui/button";
import { type LoginState, login } from "./actions";

const fieldClass =
  "h-11 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3.5 text-[15px] text-ink shadow-[var(--shadow-hairline)] outline-none transition-[border-color,box-shadow] placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15";

/** Fills in a roll number typed on the landing page, once, and moves on to the password. */
function takeHandedOffRoll(input: HTMLInputElement | null) {
  if (!input || input.value) return;
  try {
    const roll = sessionStorage.getItem(ROLL_HANDOFF);
    if (!roll) return;
    sessionStorage.removeItem(ROLL_HANDOFF);
    input.value = roll;
    document.getElementById("password")?.focus();
  } catch {
    // Storage blocked: the field just starts empty.
  }
}

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, { error: null, identifier: "" });
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <div className="space-y-2">
        <label htmlFor="identifier" className="block text-[13px] font-medium text-ink">
          Roll number or username
        </label>
        <input
          id="identifier"
          ref={takeHandedOffRoll}
          name="identifier"
          defaultValue={state.identifier}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
          className={fieldClass}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="block text-[13px] font-medium text-ink">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            className={`${fieldClass} pr-11`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-ink-subtle transition-colors hover:bg-hover hover:text-ink"
          >
            {showPassword ? <EyeOff className="size-4" strokeWidth={1.75} /> : <Eye className="size-4" strokeWidth={1.75} />}
          </button>
        </div>
      </div>
      {state.error && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" /> : "Sign in"}
      </Button>
    </form>
  );
}
