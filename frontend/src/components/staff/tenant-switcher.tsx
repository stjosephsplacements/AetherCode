"use client";

import { useRef } from "react";
import { chooseTenant } from "@/app/staff/actions";
import { Select } from "@/components/staff/form";
import type { Tenant } from "@/lib/api-types";

export function TenantSwitcher({ tenants, current }: { tenants: Tenant[]; current: string | null }) {
  const form = useRef<HTMLFormElement>(null);
  if (tenants.length === 0) return null;
  return (
    <form ref={form} action={chooseTenant}>
      <label htmlFor="tenant_id" className="mb-1.5 block px-0.5 font-[family-name:var(--font-eyebrow)] text-[10.5px] uppercase tracking-[0.14em] text-ink-subtle">
        College
      </label>
      <Select id="tenant_id" name="tenant_id" defaultValue={current ?? undefined} onValueChange={() => form.current?.requestSubmit()}>
        {tenants.map((tenant) => (
          <option key={tenant.id} value={tenant.id}>
            {tenant.display_name}
          </option>
        ))}
      </Select>
    </form>
  );
}
