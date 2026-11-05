"use client";

import { useActionState, useEffect, useState } from "react";
import { type LoginState, type VerifyState, login, verifyLogin } from "./actions";

const fieldClass =
  "h-11 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3.5 font-mono text-[15px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, { error: null, identifier: "" });
  const [expiredFor, setExpiredFor] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // The password was right and the account has a second factor: ask for the code (or a recovery code).
  if (state.challenge && state.challenge !== expiredFor) {
    return <MFAStep challenge={state.challenge} identifier={state.identifier} next={next} onExpired={() => setExpiredFor(state.challenge ?? null)} />;
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <div className="space-y-2">
        <label htmlFor="identifier" className="block font-mono text-[13px] text-ink">
          <span aria-hidden className="text-brand">&gt; </span>roll number or username
        </label>
        <input
          id="identifier"
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
        <label htmlFor="password" className="block font-mono text-[13px] text-ink">
          <span aria-hidden className="text-brand">&gt; </span>password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            className={`${fieldClass} pr-20`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 font-mono text-[13px] text-ink-subtle transition-colors hover:text-ink"
          >
            {showPassword ? "[hide]" : "[show]"}
          </button>
        </div>
      </div>
      {(state.error || state.challenge) && (
        <p role="alert" className="border border-danger bg-danger-soft px-3.5 py-2.5 font-mono text-[13.5px] text-danger">
          [!] {state.error ?? "This sign-in expired. Enter your password again."}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-brand py-3 text-[15px] font-medium text-brand-ink transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Checking..." : "Sign in"}
      </button>
    </form>
  );
}

function MFAStep({ challenge, identifier, next, onExpired }: { challenge: string; identifier: string; next: string; onExpired: () => void }) {
  const [state, action, pending] = useActionState<VerifyState, FormData>(verifyLogin, { error: null });
  useEffect(() => {
    if (state.expired) onExpired();
  }, [state.expired, onExpired]);
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="mfa_challenge_token" value={challenge} />
      <p className="font-mono text-[13px] text-ink-muted">Two-factor sign-in for {identifier}.</p>
      <div className="space-y-2">
        <label htmlFor="code" className="block font-mono text-[13px] text-ink">
          <span aria-hidden className="text-brand">&gt; </span>authenticator code or recovery code
        </label>
        <input
          id="code"
          name="code"
          inputMode="text"
          autoComplete="one-time-code"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
          className={fieldClass}
        />
      </div>
      {state.error && (
        <p role="alert" className="border border-danger bg-danger-soft px-3.5 py-2.5 font-mono text-[13.5px] text-danger">
          [!] {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-brand py-3 text-[15px] font-medium text-brand-ink transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Checking..." : "Verify and sign in"}
      </button>
    </form>
  );
}
