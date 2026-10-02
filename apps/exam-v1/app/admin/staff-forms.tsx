"use client";

import { useActionState } from "react";
import { createStaff, reissueBatch, resetPassword } from "./actions";
import { CredentialsTable } from "@/components/credentials";
import { Button, Card, Field, inputClass } from "@/components/ui";

export function CreateStaff() {
  const [state, action, pending] = useActionState(createStaff, {});
  return (
    <Card className="p-6">
      <h2 className="font-display text-xl font-semibold tracking-tight">Add faculty</h2>
      <form action={action} className="mt-5 grid gap-3 sm:grid-cols-2">
        <Field label="Username">
          <input name="username" required className={inputClass} />
        </Field>
        <Field label="Full name">
          <input name="name" required className={inputClass} />
        </Field>
        <Field label="Role">
          <select name="role" className={inputClass} defaultValue="faculty">
            <option value="faculty">Faculty</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={pending} className="w-full">
            Create account
          </Button>
        </div>
      </form>
      {state.error && <p className="mt-3 text-sm text-error">{state.error}</p>}
      {state.credential && <CredentialsTable credentials={[state.credential]} />}
    </Card>
  );
}

export function ResetPassword() {
  const [state, action, pending] = useActionState(resetPassword, {});
  return (
    <Card className="p-6">
      <h2 className="font-display text-xl font-semibold tracking-tight">Reset a password</h2>
      <p className="mt-1 text-sm text-muted">Signs the user out everywhere and issues a new password.</p>
      <form action={action} className="mt-5 flex gap-2">
        <input name="username" placeholder="Username or roll number" required className={inputClass} />
        <Button type="submit" variant="secondary" disabled={pending}>
          Reset
        </Button>
      </form>
      {state.error && <p className="mt-3 text-sm text-error">{state.error}</p>}
      {state.credential && <CredentialsTable credentials={[state.credential]} />}
    </Card>
  );
}

export function ReissueBatch({ batches }: { batches: string[] }) {
  const [state, action, pending] = useActionState(reissueBatch, {});
  return (
    <Card className="p-6">
      <h2 className="font-display text-xl font-semibold tracking-tight">Reissue a batch</h2>
      <p className="mt-1 text-sm text-muted">New passwords for every student in the batch, for reprinting lost slips. Their old passwords stop working.</p>
      <form action={action} className="mt-5 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <select name="batch" required className={inputClass} defaultValue="">
          <option value="" disabled>
            Choose batch
          </option>
          {batches.map((batch) => (
            <option key={batch}>{batch}</option>
          ))}
        </select>
        <input name="confirm" placeholder="Type batch name to confirm" required className={inputClass} />
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Issuing…" : "Reissue"}
        </Button>
      </form>
      {state.error && <p className="mt-3 text-sm text-error">{state.error}</p>}
      {state.credentials && <CredentialsTable credentials={state.credentials} />}
    </Card>
  );
}
