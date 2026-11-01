"use client";

import { useRef, useState } from "react";
import { chooseTenant } from "@/app/staff/actions";
import { Select } from "@/components/staff/form";
import type { Tenant } from "@/lib/api-types";

export function TenantSwitcher({ tenants, current }: { tenants: Tenant[]; current: string | null }) {
  const form = useRef<HTMLFormElement>(null);
  // Controlled on purpose: React resets a form when its action finishes, and an uncontrolled Select would
  // fall back to the college it started with, which is the one just switched away from.
  const [chosen, setChosen] = useState(current ?? "");
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setChosen(current ?? "");
  }
  if (tenants.length === 0) return null;
  return (
    <form ref={form} action={chooseTenant}>
      <label htmlFor="tenant_id" className="mb-1.5 block px-0.5 font-[family-name:var(--font-eyebrow)] text-[10.5px] uppercase tracking-[0.14em] text-ink-subtle">
        College
      </label>
      <Select
        id="tenant_id"
        name="tenant_id"
        value={chosen}
        onValueChange={(next) => {
          setChosen(next);
          form.current?.requestSubmit();
        }}
      >
        {tenants.map((tenant) => (
          <option key={tenant.id} value={tenant.id}>
            {tenant.display_name}
          </option>
        ))}
      </Select>
    </form>
  );
}
