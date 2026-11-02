"use client";

import { Upload } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { CredentialsTable } from "@/components/staff/credentials";
import { Field, FormMessage, Select, SubmitButton, TextArea, initialActionState } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { Department } from "@/lib/api-types";
import { type StaffImportState, importStaff } from "./actions";

/** Add many staff from a pasted list or a CSV file; they all get the same role and place. */
export function ImportStaffDialog({
  departments,
  colleges,
}: {
  departments: (Department & { collegeId: string; collegeName: string })[];
  colleges?: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<StaffImportState, FormData>(importStaff, initialActionState);
  const [role, setRole] = useState("department_user");
  const [college, setCollege] = useState(colleges?.[0]?.id ?? "");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const shown = colleges ? departments.filter((department) => department.collegeId === college) : departments;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Upload />
          Bulk import
        </Button>
      </DialogTrigger>
      <DialogContent title="Bulk add staff" description="Everyone in the list gets the selected role and department. Each receives a one-time password." className="w-[min(94vw,640px)]">
        <form action={action} className="min-h-0 space-y-4 overflow-y-auto p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {colleges && (
              <Field label="College" htmlFor="bulk-staff-college">
                <Select id="bulk-staff-college" name="college_id" required value={college} onValueChange={setCollege}>
                  {colleges.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Role" htmlFor="bulk-staff-role">
              <Select id="bulk-staff-role" name="role" value={role} onValueChange={setRole}>
                <option value="department_user">Faculty</option>
                <option value="college_admin">College administrator</option>
              </Select>
            </Field>
            {role === "department_user" && (
              <Field label="Department" htmlFor="bulk-staff-department" className={colleges ? "sm:col-span-2" : undefined}>
                <Select id="bulk-staff-department" name="department_id" required>
                  {shown.map((department) => (
                    <option key={department.id} value={`${department.collegeId}:${department.id}`}>
                      {department.name} ({department.code})
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          <Field
            label="People"
            htmlFor="bulk-staff-csv"
            hint="One per line: username, full name, and optional email. Header row is ignored."
          >
            <TextArea
              ref={textarea}
              id="bulk-staff-csv"
              name="csv"
              required
              spellCheck={false}
              placeholder={"meera.k,Dr. Meera Krishnan,meera@example.edu\nravi.s,Ravi Shankar"}
              className="min-h-36 font-mono text-xs"
            />
          </Field>
          <div className="flex items-center justify-between">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-medium text-brand hover:underline">
              <Upload className="size-4" strokeWidth={1.75} />
              Load a CSV file
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                className="sr-only"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (file && textarea.current) textarea.current.value = await file.text();
                }}
              />
            </label>
          </div>
          <FormMessage state={state} />
          <SubmitButton>Add staff</SubmitButton>
          {state.failed && state.failed.length > 0 && (
            <ul className="space-y-1 rounded-md border border-danger/20 bg-danger/5 p-3 text-[13px] text-danger">
              {state.failed.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {state.created && state.created.length > 0 && (
            <div className="pt-2">
              <CredentialsTable filename="staff-passwords.csv" rows={state.created} />
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
