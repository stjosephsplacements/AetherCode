"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/staff/form";
import { type EnrollState, activateTOTP, beginTOTP } from "./actions";

const empty: EnrollState = { error: null };

/** Adds an authenticator app: start, type the seed into the app, confirm with a code, keep the recovery codes. */
export function TotpEnroll() {
  const [begun, begin, beginning] = useActionState(beginTOTP, empty);
  const [activated, activate, activating] = useActionState(activateTOTP, begun);

  if (activated.recoveryCodes) {
    return (
      <div className="space-y-3" data-testid="recovery-codes">
        <p className="text-sm text-ink">Two-factor sign-in is on. Save these recovery codes now; each works once and they are not shown again.</p>
        <ul className="grid grid-cols-2 gap-2 rounded-md border border-line bg-surface p-3 font-mono text-sm text-ink">
          {activated.recoveryCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </div>
    );
  }

  const pending = begun.factorId ? begun : null;
  if (!pending) {
    return (
      <form action={begin} className="space-y-4">
        <Field label="Name for this authenticator" htmlFor="totp-label" hint="For example the phone it lives on.">
          <TextInput id="totp-label" name="label" defaultValue="Authenticator" maxLength={120} />
        </Field>
        {begun.error && <p role="alert" className="text-sm text-danger">{begun.error}</p>}
        <Button type="submit" disabled={beginning}>{beginning ? "Starting..." : "Set up authenticator"}</Button>
      </form>
    );
  }

  return (
    <form action={activate} className="space-y-4">
      <input type="hidden" name="factor_id" value={pending.factorId} />
      <p className="text-sm text-ink-muted">
        In your authenticator app choose to add an account with a key, and enter this key. Then type the 6-digit code it shows.
      </p>
      <p className="break-all rounded-md border border-line bg-surface p-3 font-mono text-sm text-ink" data-testid="totp-secret">{pending.secret}</p>
      <Field label="6-digit code" htmlFor="totp-code">
        <TextInput id="totp-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />
      </Field>
      {(activated.error ?? begun.error) && <p role="alert" className="text-sm text-danger">{activated.error ?? begun.error}</p>}
      <Button type="submit" disabled={activating}>{activating ? "Checking..." : "Turn on two-factor sign-in"}</Button>
    </form>
  );
}
