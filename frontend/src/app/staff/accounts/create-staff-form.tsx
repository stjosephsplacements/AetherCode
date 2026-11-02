"use client";

import { Plus } from "lucide-react";
import { useActionState, useState } from "react";
import { CredentialsTable } from "@/components/staff/credentials";
import { Field, FormMessage, Select, SubmitButton, TextInput, initialActionState } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { Department } from "@/lib/api-types";
import { type StaffState, createStaff } from "./actions";

export function CreateStaffDialog({
  departments,
  colleges,
}: {
  departments: (Department & { collegeId: string; collegeName: string })[];
  colleges?: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<StaffState, FormData>(createStaff, initialActionState);
  const [role, setRole] = useState("department_user");
  const [college, setCollege] = useState(colleges?.[0]?.id ?? "");

  const shown = colleges ? departments.filter((department) => department.collegeId === college) : departments;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus />
          Add staff
        </Button>
      </DialogTrigger>
      <DialogContent title="New staff account" description="Create a faculty or college administrator. A one-time password will be generated." className="w-[min(92vw,540px)]">
        <form action={action} className="min-h-0 space-y-4 overflow-y-auto p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="staff-name">
              <TextInput id="staff-name" name="display_name" required placeholder="Dr. Meera Krishnan" />
            </Field>
            <Field label="Username" htmlFor="staff-username" hint="Login identifier">
              <TextInput id="staff-username" name="username" required pattern="[A-Za-z0-9._-]{3,64}" placeholder="meera.k" autoCapitalize="none" />
            </Field>
            {colleges && (
              <Field label="College" htmlFor="staff-college">
                <Select id="staff-college" name="college_id" required value={college} onValueChange={setCollege}>
                  {colleges.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Role" htmlFor="staff-role">
              <Select id="staff-role" name="role" value={role} onValueChange={setRole}>
                <option value="department_user">Faculty</option>
                <option value="college_admin">College administrator</option>
              </Select>
            </Field>
            {role === "department_user" && (
              <Field label="Department" htmlFor="staff-department" className={colleges ? "sm:col-span-2" : undefined}>
                <Select id="staff-department" name="department_id" required>
                  {shown.map((department) => (
                    <option key={department.id} value={`${department.collegeId}:${department.id}`}>
                      {department.name} ({department.code})
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Email" htmlFor="staff-email" hint="Optional" className={role !== "department_user" && !colleges ? "sm:col-span-2" : undefined}>
              <TextInput id="staff-email" name="email" type="email" placeholder="meera@example.edu" />
            </Field>
          </div>
          <FormMessage state={state} />
          <SubmitButton>Create account</SubmitButton>
          {state.created && (
            <div className="pt-2">
              <CredentialsTable filename={`${state.created.username}-password.csv`} rows={[state.created]} />
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
