"use client";

import { KeyRound, MoreHorizontal, Upload, UserPlus } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useActionState, useRef } from "react";
import { CredentialsTable } from "@/components/staff/credentials";
import { Field, FormMessage, Select, SubmitButton, TextArea, TextInput, initialActionState } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { Batch, Department } from "@/lib/api-types";
import {
  type CredentialsState,
  type ImportState,
  importStudents,
  reissueBatchPasswords,
  resetPassword,
  setAccountStatus,
} from "./actions";

type PlacementOption = { id: string; label: string };

export function ImportPanel({ batches, placements, departments }: { batches: Batch[]; placements: PlacementOption[]; departments: Department[] }) {
  const [state, action] = useActionState<ImportState, FormData>(importStudents, initialActionState);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const departmentName = new Map(departments.map((department) => [department.id, department.code]));

  async function loadFile(file: File | undefined) {
    if (file && textarea.current) textarea.current.value = await file.text();
  }

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Batch" htmlFor="import-batch" hint="The college department comes from the batch.">
          <Select id="import-batch" name="batch_id" required>
            {batches.map((batch) => (
              <option key={batch.id} value={`${batch.tenant_id}:${batch.id}`}>
                {batch.name} ({departmentName.get(batch.department_id) ?? "?"}, {batch.academic_year})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Placement department" htmlFor="import-placement">
          <Select id="import-placement" name="placement_department_id" required>
            {placements.map((placement) => (
              <option key={placement.id} value={placement.id}>
                {placement.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Students" htmlFor="import-csv" hint="One student per line: roll number, name, and optionally email. A header row is skipped. Up to 500 at a time.">
        <TextArea
          ref={textarea}
          id="import-csv"
          name="csv"
          required
          spellCheck={false}
          placeholder={"roll_number,name,email\n21CS001,Asha Raman,asha@example.edu\n21CS002,Vikram Iyer"}
          className="min-h-40 font-mono text-xs"
        />
      </Field>
      <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-medium text-brand hover:underline">
        <Upload className="size-4" strokeWidth={1.75} />
        Load a CSV file
        <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(event) => loadFile(event.target.files?.[0])} />
      </label>
      <FormMessage state={state} />
      <SubmitButton>Import students</SubmitButton>
      {state.result && state.result.imported.length > 0 && (
        <CredentialsTable
          filename="student-passwords.csv"
          rows={state.result.imported.map((student) => ({ username: student.username, name: student.name, password: student.password }))}
        />
      )}
    </form>
  );
}

export function ReissuePanel({ batch }: { batch: Batch }) {
  const [state, action] = useActionState<CredentialsState, FormData>(reissueBatchPasswords, initialActionState);
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!confirm(`Give every student in ${batch.name} a new password? Their current passwords stop working and they are signed out.`)) event.preventDefault();
      }}
      className="space-y-3"
    >
      <input type="hidden" name="batch_id" value={batch.id} />
      <input type="hidden" name="college_id" value={batch.tenant_id} />
      <FormMessage state={state} />
      <SubmitButton variant="secondary">
        <KeyRound />
        Reissue all passwords
      </SubmitButton>
      {state.accounts && (
        <CredentialsTable
          filename={`${batch.code}-passwords.csv`}
          rows={state.accounts.map((account) => ({ username: account.username ?? "", name: account.display_name, password: account.password }))}
        />
      )}
    </form>
  );
}

/** Per-student actions: reset the password, or turn sign-in off and on. */
export function StudentActions({ principalId, username, collegeId }: { principalId: string; username: string; collegeId: string }) {
  const [reset, resetAction] = useActionState<CredentialsState, FormData>(resetPassword, initialActionState);
  const [status, statusAction] = useActionState(setAccountStatus, initialActionState);
  const item = "flex w-full items-center rounded-md px-2.5 py-2 text-left text-sm text-ink outline-none data-[highlighted]:bg-hover";
  return (
    <div className="flex items-center justify-end gap-2">
      {reset.accounts?.[0] && (
        <span className="rounded-md bg-warning-soft px-2 py-1 font-mono text-xs text-ink">
          New password <span className="select-all font-semibold">{reset.accounts[0].password}</span>
        </span>
      )}
      {(reset.error || status.error || status.message) && (
        <span className={reset.error || status.error ? "text-xs text-danger" : "text-xs text-success"}>{reset.error ?? status.error ?? status.message}</span>
      )}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger aria-label={`Actions for ${username}`} className="grid size-8 place-items-center rounded-[var(--radius-control)] text-ink-muted hover:bg-hover hover:text-ink">
          <MoreHorizontal className="size-4" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-[190px] animate-fade rounded-[var(--radius-control)] border border-line bg-surface p-1 shadow-[var(--shadow-overlay)]">
            <form action={resetAction}>
              <input type="hidden" name="principal_id" value={principalId} />
              <input type="hidden" name="college_id" value={collegeId} />
              <input type="hidden" name="username" value={username} />
              <DropdownMenu.Item asChild>
                <button type="submit" className={item}>
                  Reset password
                </button>
              </DropdownMenu.Item>
            </form>
            {(["disabled", "active"] as const).map((value) => (
              <form key={value} action={statusAction}>
                <input type="hidden" name="principal_id" value={principalId} />
              <input type="hidden" name="college_id" value={collegeId} />
                <input type="hidden" name="status" value={value} />
                <DropdownMenu.Item asChild>
                  <button type="submit" className={item}>
                    {value === "disabled" ? "Disable sign-in" : "Enable sign-in"}
                  </button>
                </DropdownMenu.Item>
              </form>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

export function ImportDialog(props: { batches: Batch[]; placements: PlacementOption[]; departments: Department[]; disabledReason?: string }) {
  const { disabledReason, ...panel } = props;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button disabled={Boolean(disabledReason)} title={disabledReason}>
          <Upload />
          Bulk import
        </Button>
      </DialogTrigger>
      <DialogContent title="Import students" description="Each student gets a username (their roll number in lowercase) and a one-time password.">
        <div className="min-h-0 overflow-y-auto p-6">
          <ImportPanel {...panel} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Enrol one student. It goes through the same import route, with a single line. */
export function EnrolDialog({ batches, placements, departments, disabledReason }: { batches: Batch[]; placements: PlacementOption[]; departments: Department[]; disabledReason?: string }) {
  const code = new Map(departments.map((department) => [department.id, department.code]));
  const [state, action] = useActionState<ImportState, FormData>(async (previous, form) => {
    const cell = (name: string) => String(form.get(name) ?? "").replace(/[,\n\r]/g, " ").trim();
    form.set("csv", [cell("roll"), cell("name"), cell("email")].join(","));
    return importStudents(previous, form);
  }, initialActionState);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button disabled={Boolean(disabledReason)} title={disabledReason}>
          <UserPlus />
          Enrol student
        </Button>
      </DialogTrigger>
      <DialogContent title="Enrol a student" description="They get a username (their roll number in lowercase) and a one-time password.">
        <form action={action} className="min-h-0 space-y-4 overflow-y-auto p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Roll number" htmlFor="enrol-roll">
              <TextInput id="enrol-roll" name="roll" required placeholder="21CS001" />
            </Field>
            <Field label="Full name" htmlFor="enrol-name">
              <TextInput id="enrol-name" name="name" required placeholder="Asha Raman" />
            </Field>
          </div>
          <Field label="Email" htmlFor="enrol-email" hint="Optional.">
            <TextInput id="enrol-email" name="email" type="email" placeholder="asha@example.edu" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Batch" htmlFor="enrol-batch">
              <Select id="enrol-batch" name="batch_id" required>
                {batches.map((batch) => (
                  <option key={batch.id} value={`${batch.tenant_id}:${batch.id}`}>
                    {batch.name} ({code.get(batch.department_id) ?? "?"}, {batch.academic_year})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Placement department" htmlFor="enrol-placement">
              <Select id="enrol-placement" name="placement_department_id" required>
                {placements.map((placement) => (
                  <option key={placement.id} value={placement.id}>
                    {placement.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <FormMessage state={state} />
          <SubmitButton>Enrol</SubmitButton>
          {state.result && state.result.imported.length > 0 && (
            <CredentialsTable filename="student-password.csv" rows={state.result.imported.map((student) => ({ username: student.username, name: student.name, password: student.password }))} />
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
