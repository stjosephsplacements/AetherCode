"use client";

import { ArrowLeft, DotsThree, DownloadSimple, Key, UploadSimple, UserPlus, Warning } from "@phosphor-icons/react/ssr";
import { DropdownMenu } from "radix-ui";
import { useActionState, useMemo, useState, useTransition } from "react";
import { CredentialsTable } from "@/components/staff/credentials";
import { Field, FormMessage, Select, SubmitButton, TextArea, TextInput, initialActionState } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/card";
import type { Batch, Department } from "@/lib/api-types";
import { cn } from "@/lib/utils";
import {
  type CredentialsState,
  type ImportState,
  importStudents,
  reissueBatchPasswords,
  resetPassword,
  setAccountStatus,
} from "./actions";
import { IMPORT_TEMPLATE, MAX_IMPORT_ROWS, importText, parseImport } from "./format";

type PlacementOption = { id: string; label: string };

function ModalSection({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-control border border-line bg-hover/25 p-4">
      <div className="mb-3">
        <h3 className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-subtle">{label}</h3>
        {note && <p className="mt-1 text-[12.5px] text-ink-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function ModalFooter({ children }: { children: React.ReactNode }) {
  return <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-sidebar/60 px-6 py-3">{children}</footer>;
}

export function ImportPanel({ batches, placements, departments }: { batches: Batch[]; placements: PlacementOption[]; departments: Department[] }) {
  const [state, action] = useActionState<ImportState, FormData>(importStudents, initialActionState);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const departmentName = new Map(departments.map((department) => [department.id, department.code]));
  const lines = useMemo(() => parseImport(text), [text]);
  const problems = lines.filter((entry) => entry.problem).length;
  const ready = lines.length - problems;
  const tooMany = lines.length > MAX_IMPORT_ROWS;

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([IMPORT_TEMPLATE], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: "students-template.csv" }).click();
    URL.revokeObjectURL(url);
  }

  async function load(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setFileError("That file is too large for 500 students. Choose a CSV.");
    setText(await file.text());
    setFileName(file.name);
    setReviewing(false);
  }

  if (state.result && state.result.imported.length > 0) {
    return (
      <div className="space-y-4 px-6 py-5">
        <ModalSection label="Imported" note="Share these one-time passwords once. They are not shown again.">
          <FormMessage state={state} />
          <div className="mt-3">
            <CredentialsTable filename="student-passwords.csv" rows={state.result.imported.map((student) => ({ username: student.username, name: student.name, password: student.password }))} />
          </div>
        </ModalSection>
      </div>
    );
  }

  return (
    <form action={action} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <ModalSection label="Destination" note="The college department comes from the batch.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Batch" htmlFor="import-batch">
              <Select id="import-batch" name="batch_id" required>
                {batches.map((batch) => (
                  <option key={batch.id} value={`${batch.tenant_id}:${batch.id}`}>
                    {batch.name} ({departmentName.get(batch.department_id) ?? "?"}, {batch.academic_year})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Placement department" htmlFor="import-placement">
              <Select id="import-placement" name="placement_department_id">
                <option value="">None</option>
                {placements.map((placement) => (
                  <option key={placement.id} value={placement.id}>
                    {placement.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </ModalSection>
        <input type="hidden" name="csv" value={importText(lines)} />

        {reviewing ? (
          <ModalSection label="Preview" note={`${ready} ready${problems > 0 ? `, ${problems} to fix` : ""}.`}>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
              <Badge tone="success">{ready} ready</Badge>
              {problems > 0 && <Badge tone="danger">{problems} to fix</Badge>}
              {tooMany && <Badge tone="danger">Over {MAX_IMPORT_ROWS}: split the file</Badge>}
              <button type="button" onClick={() => setReviewing(false)} className="ml-auto inline-flex items-center gap-1 text-brand hover:underline">
                <ArrowLeft className="size-3.5" />
                Edit
              </button>
            </div>
            <div className="max-h-72 overflow-auto rounded-control border border-line bg-surface">
              <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 bg-sidebar">
                  <tr className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">
                    <th scope="col" className="px-3 py-2 font-normal">Line</th>
                    <th scope="col" className="px-3 py-2 font-normal">Roll number</th>
                    <th scope="col" className="px-3 py-2 font-normal">Name</th>
                    <th scope="col" className="px-3 py-2 font-normal">Email</th>
                  </tr>
                </thead>
                <tbody className="[&_tr+tr]:border-t [&_tr+tr]:border-line">
                  {lines.map((entry) => (
                    <tr key={entry.line} className={entry.problem ? "bg-danger-soft/60" : undefined}>
                      <td className="px-3 py-1.5 font-mono text-ink-subtle">{entry.line}</td>
                      <td className="px-3 py-1.5 font-mono">{entry.roll || "-"}</td>
                      <td className="px-3 py-1.5">
                        {entry.name || "-"}
                        {entry.problem && (
                          <span role="alert" className="mt-0.5 flex items-center gap-1 text-[12px] text-danger">
                            <Warning className="size-3.5 shrink-0" />
                            {entry.problem}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-ink-muted">{entry.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {problems > 0 && (
              <button type="button" onClick={() => setText(importText(lines))} className="mt-3 text-[13px] text-brand hover:underline">
                Remove the {problems} line{problems === 1 ? "" : "s"} with problems
              </button>
            )}
          </ModalSection>
        ) : (
          <ModalSection label="Spreadsheet" note={`Roll number, name, and optionally email. Up to ${MAX_IMPORT_ROWS} students.`}>
            <label
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void load(event.dataTransfer.files[0]);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-1.5 rounded-control border border-dashed px-6 py-8 text-center transition-colors focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15",
                dragging ? "border-brand bg-brand-soft/40" : "border-line-strong bg-surface hover:bg-hover",
              )}
            >
              <span className="grid size-10 place-items-center rounded-control bg-brand/15 text-brand">
                <UploadSimple aria-hidden className="size-5" />
              </span>
              <span className="text-sm font-medium text-ink">{fileName || "Drop a CSV here, or choose one"}</span>
              <span className="text-[12.5px] text-ink-muted">Accepted: .csv · max 2 MB</span>
              <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(event) => void load(event.target.files?.[0])} />
            </label>
            {fileError && (
              <p role="alert" className="mt-2 text-[13px] text-danger">
                {fileError}
              </p>
            )}
            <div className="mt-3 rounded-control border border-line bg-surface px-4 py-3 text-[12.5px] text-ink-muted">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">File format</span>
                <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline">
                  <DownloadSimple className="size-3.5" />
                  Download template
                </button>
              </div>
              <pre className="overflow-x-auto rounded-control bg-hover/50 px-3 py-2 font-mono text-[12px] text-ink">{IMPORT_TEMPLATE}</pre>
              <ul className="mt-2 list-disc space-y-0.5 pl-4">
                <li>
                  <span className="font-mono text-ink">roll_number</span>: required, no spaces, up to 40 characters, unique in the college. It becomes the username in lowercase.
                </li>
                <li>
                  <span className="font-mono text-ink">name</span>: required, up to 120 characters, no commas.
                </li>
                <li>
                  <span className="font-mono text-ink">email</span>: optional. Leave it empty or leave the column out.
                </li>
                <li>The header row is optional. Batch and placement are chosen above, not in the file.</li>
              </ul>
            </div>
            <div className="mt-3">
              <Field label="Or paste the list" htmlFor="import-csv" hint="A header row is skipped.">
                <TextArea
                  id="import-csv"
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                    setFileName("");
                  }}
                  spellCheck={false}
                  placeholder={"roll_number,name,email\n21CS001,Asha Raman,asha@example.edu\n21CS002,Vikram Iyer"}
                  className="min-h-32 font-mono text-xs"
                />
              </Field>
            </div>
          </ModalSection>
        )}

        {!reviewing && <FormMessage state={state} />}
        {reviewing && state.error && <FormMessage state={state} />}
      </div>

      <ModalFooter>
        {reviewing ? (
          <SubmitButton className={ready === 0 || problems > 0 || tooMany ? "pointer-events-none opacity-50" : undefined}>
            Import {ready} student{ready === 1 ? "" : "s"}
          </SubmitButton>
        ) : (
          <Button type="button" disabled={lines.length === 0} onClick={() => setReviewing(true)}>
            Review {lines.length || ""} student{lines.length === 1 ? "" : "s"}
          </Button>
        )}
      </ModalFooter>
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
        <Key />
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

/** Per-student actions: reset the password, or turn sign-in off and on. The result is shown in a dialog and the row's badge follows. */
export function StudentActions({ principalId, username, collegeId, status }: { principalId: string; username: string; collegeId: string; status: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ title: string; error?: string; password?: string } | null>(null);
  const enabled = status === "active";
  const item = "flex w-full items-center rounded-control px-2.5 py-2 text-left text-sm text-ink outline-none data-[highlighted]:bg-hover";
  const form = (extra: Record<string, string> = {}) => {
    const data = new FormData();
    data.set("principal_id", principalId);
    data.set("college_id", collegeId);
    data.set("username", username);
    for (const [key, value] of Object.entries(extra)) data.set(key, value);
    return data;
  };
  const reset = () =>
    start(async () => {
      const done = await resetPassword(initialActionState, form());
      setResult(done.error ? { title: "Could not reset the password", error: done.error } : { title: `New password for ${username}`, password: done.accounts?.[0]?.password });
    });
  const toggle = () =>
    start(async () => {
      const next = enabled ? "disabled" : "active";
      const done = await setAccountStatus(initialActionState, form({ status: next }));
      setResult(done.error ? { title: enabled ? "Could not disable sign-in" : "Could not enable sign-in", error: done.error } : { title: done.message ?? "" });
    });
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger disabled={pending} aria-label={`Actions for ${username}`} className="grid size-8 place-items-center rounded-control text-ink-muted hover:bg-hover hover:text-ink disabled:opacity-50">
          <DotsThree className="size-4" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-[190px] animate-fade rounded-control border border-line bg-surface p-1 shadow-[var(--shadow-overlay)]">
            <DropdownMenu.Item className={item} onSelect={reset}>
              Reset password
            </DropdownMenu.Item>
            <DropdownMenu.Item className={item} onSelect={toggle}>
              {enabled ? "Disable sign-in" : "Enable sign-in"}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Dialog open={result !== null} onOpenChange={(open) => !open && setResult(null)}>
        <DialogContent
          eyebrow="Account"
          title={result?.title || "Done"}
          icon={<Key className="size-5" />}
          className="w-[min(92vw,420px)]"
        >
          <div className="space-y-4 px-6 py-5">
            {result?.error ? (
              <p role="alert" className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">
                {result.error}
              </p>
            ) : result?.password ? (
              <ModalSection label="One-time password" note="Share this once. It is not shown again and the student must change it at first sign-in.">
                <p className="select-all rounded-control border border-warning/30 bg-warning-soft px-3 py-2.5 font-mono text-base font-semibold text-ink">{result.password}</p>
              </ModalSection>
            ) : (
              <p className="text-sm text-ink-muted">The status badge in the row is updated.</p>
            )}
          </div>
          <ModalFooter>
            <DialogClose asChild>
              <Button variant="secondary" size="sm">
                Done
              </Button>
            </DialogClose>
          </ModalFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ImportDialog(props: { batches: Batch[]; placements: PlacementOption[]; departments: Department[]; disabledReason?: string }) {
  const { disabledReason, ...panel } = props;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button disabled={Boolean(disabledReason)} title={disabledReason}>
          <UploadSimple />
          Bulk import
        </Button>
      </DialogTrigger>
      <DialogContent
        eyebrow="Students"
        title="Import students"
        description="Each student gets a username (their roll number in lowercase) and a one-time password."
        icon={<UploadSimple className="size-5" />}
        className="w-[min(94vw,760px)]"
      >
        <ImportPanel {...panel} />
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
  const done = state.result && state.result.imported.length > 0;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button disabled={Boolean(disabledReason)} title={disabledReason}>
          <UserPlus />
          Enrol student
        </Button>
      </DialogTrigger>
      <DialogContent
        eyebrow="Students"
        title={done ? "Student enrolled" : "Enrol a student"}
        description={done ? "Share the one-time password once. It is not shown again." : "They get a username (their roll number in lowercase) and a one-time password."}
        icon={<UserPlus className="size-5" />}
        className="w-[min(92vw,560px)]"
      >
        {done ? (
          <>
            <div className="space-y-4 px-6 py-5">
              <FormMessage state={state} />
              <ModalSection label="Credentials">
                <CredentialsTable filename="student-password.csv" rows={state.result!.imported.map((student) => ({ username: student.username, name: student.name, password: student.password }))} />
              </ModalSection>
            </div>
            <ModalFooter>
              <DialogClose asChild>
                <Button variant="secondary" size="sm">
                  Done
                </Button>
              </DialogClose>
            </ModalFooter>
          </>
        ) : (
          <form action={action} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
              <ModalSection label="Student" note="Roll number becomes the username in lowercase.">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Roll number" htmlFor="enrol-roll">
                    <TextInput id="enrol-roll" name="roll" required placeholder="21CS001" />
                  </Field>
                  <Field label="Full name" htmlFor="enrol-name">
                    <TextInput id="enrol-name" name="name" required placeholder="Asha Raman" />
                  </Field>
                </div>
                <div className="mt-3">
                  <Field label="Email" htmlFor="enrol-email" hint="Optional.">
                    <TextInput id="enrol-email" name="email" type="email" placeholder="asha@example.edu" />
                  </Field>
                </div>
              </ModalSection>
              <ModalSection label="Placement" note="Department comes from the batch.">
                <div className="grid gap-3 sm:grid-cols-2">
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
                    <Select id="enrol-placement" name="placement_department_id">
                      <option value="">None</option>
                      {placements.map((placement) => (
                        <option key={placement.id} value={placement.id}>
                          {placement.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </ModalSection>
              <FormMessage state={state} />
            </div>
            <ModalFooter>
              <SubmitButton>Enrol</SubmitButton>
            </ModalFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
