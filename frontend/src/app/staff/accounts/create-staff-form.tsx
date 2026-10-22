"use client";

import { useActionState, useState } from "react";
import { CredentialsTable } from "@/components/staff/credentials";
import { Field, FormMessage, Select, SubmitButton, TextInput, initialActionState } from "@/components/staff/form";
import type { Department } from "@/lib/api-types";
import { type StaffState, createStaff } from "./actions";

export function CreateStaffForm({ departments }: { departments: Department[] }) {
  const [state, action] = useActionState<StaffState, FormData>(createStaff, initialActionState);
  const [role, setRole] = useState("department_user");
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="staff-name">
          <TextInput id="staff-name" name="display_name" required placeholder="Dr. Meera Krishnan" />
        </Field>
        <Field label="Username" htmlFor="staff-username" hint="What they type to sign in.">
          <TextInput id="staff-username" name="username" required pattern="[A-Za-z0-9._-]{3,64}" placeholder="meera.k" autoCapitalize="none" />
        </Field>
        <Field label="Role" htmlFor="staff-role">
          <Select id="staff-role" name="role" value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="department_user">Faculty</option>
            <option value="college_admin">College administrator</option>
          </Select>
        </Field>
        {role === "department_user" && (
          <Field label="Department" htmlFor="staff-department">
            <Select id="staff-department" name="department_id" required>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name} ({department.code})
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Email (optional)" htmlFor="staff-email">
          <TextInput id="staff-email" name="email" type="email" />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton>Create account</SubmitButton>
      {state.created && <CredentialsTable filename={`${state.created.username}-password.csv`} rows={[state.created]} />}
    </form>
  );
}
